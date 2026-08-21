/**
 * Agentic REPL - Claude Code / Codex style
 *
 * User speaks naturally → AI understands intent → picks tools → executes → shows result
 *
 * Built-in tools:
 *  - read_file: Read a file
 *  - write_file: Write/create a file
 *  - edit_file: Edit part of a file
 *  - run_shell: Execute a shell command
 *  - search_files: Search for files by name/content
 *  - list_dir: List directory contents
 *  - run_skill: Run a built-in skill
 *  - list_skills: List available skills
 *  - run_code: Write and execute code (Python/Node.js/Bash)
 *
 * The AI decides which tools to call based on user intent.
 */

import readline from "readline";
import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { isPromise, isProxy } from "node:util/types";
import { logger } from "../lib/logger.js";
import { captureAmbientExecutionLocation } from "../lib/execution-location-runtime.js";
import { issueMcpStdioExecutionAuthority } from "../lib/mcp-stdio-execution-authority.js";
import { getPlanModeManager, PlanState } from "../lib/plan-mode.js";
import { createVimState, feedNormalKey } from "../lib/repl-vim.js";
import {
  analyzeContinuation,
  joinContinuation,
} from "../lib/repl-multiline.js";
import {
  classifyDenial,
  recordDenial,
  formatDenials,
} from "../lib/repl-denials.js";
import { appendRecentDenials } from "../lib/permission-denial-store.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  createSession,
  saveMessages,
  getSession,
} from "../lib/session-manager.js";
import {
  startSession as jsonlStartSession,
  appendUserMessage,
  appendAssistantMessage,
  appendCompactEventIfMessagesMatch,
  appendTokenUsage,
  appendToolCallCompact,
  appendLlmRetryCompact,
  appendEvent,
  appendAuthorityEvent,
  isUnsafeSessionId,
  sessionExists,
  forkSession,
} from "../harness/jsonl-session-store.js";
import { classifyStreamRetryReason } from "../lib/stream-retry.js";
import {
  markRuntimeLedgerPersistenceError,
  projectRuntimeTokenUsage,
  projectRuntimeUsageBoundary,
  runtimeUsageEventType,
  runtimeToolCallId,
} from "../lib/runtime-usage-ledger.js";
import { runMeteredDirectModelCall } from "../lib/direct-model-usage.js";
import {
  createSessionMcpLedgerSink,
  formatMcpLedgerRecoveryNotice,
  loadMcpLedgerRecovery,
} from "../lib/mcp-call-ledger-store.js";
import { createMcpHostRecoveryRuntime } from "../lib/mcp-host-recovery-runtime.js";
import {
  isVerifiedSessionHostSnapshot,
  readSessionHostResumeState,
} from "../lib/session-host-snapshot.js";
import { acquireSessionHostLease } from "../lib/session-host-lease.js";
import {
  openProductionSessionBudgetRoot,
  sessionBudgetAdmissionError,
} from "../lib/session-budget-production-root.js";
import {
  beginSessionBudgetUsage,
  markSessionBudgetUsageUnknown,
  recordSessionBudgetUsage,
  rejectSessionBudgetUsageUnknown,
} from "../lib/session-budget-usage.js";
import {
  SideEffectLedger,
  classifyToolSideEffect,
  reconcileSideEffects,
} from "../lib/side-effect-ledger.js";
import {
  loadSideEffectLedger,
  persistSideEffectLedger,
} from "../lib/side-effect-ledger-store.js";
import { operationIdempotencyKey } from "../lib/idempotency.js";
import { collectToolResourceIdentifiers } from "../lib/permission-side-effect-center.js";
import {
  preserveDurableSystemMessageProvenance,
  projectCanonicalResumeMessages,
} from "../lib/session-message-provenance.js";
import {
  MCP_RECOVERY_INVALID_CODE,
  classifyMcpRecoveryAdmission,
} from "../lib/mcp-ledger-recovery-admission.js";
import { CLISkillLoader } from "../lib/skill-loader.js";
import { storeMemory, consolidateMemory } from "../lib/hierarchical-memory.js";
import { CLIContextEngineering } from "../lib/cli-context-engineering.js";
import { defaultPrepareCall } from "../lib/turn-context.js";
import { createChatFn } from "../lib/cowork-adapter.js";
import {
  detectTaskType,
  selectModelForTask,
} from "../lib/task-model-selector.js";
import { runnableTaskModel, hasUsableKey } from "../lib/runnable-provider.js";
import { CLIPermanentMemory } from "../lib/permanent-memory.js";
import { CLIAutonomousAgent, GoalStatus } from "../lib/autonomous-agent.js";
import {
  estimateMessagesTokens,
  PromptCompressor,
  estimateTokens,
  getContextWindow,
} from "../harness/prompt-compressor.js";
import { compactConversationWithProvider } from "../harness/provider-backed-compaction.js";
import { isAbortError } from "../lib/abort-utils.js";
import {
  buildAutoPinPredicate,
  resolveAutoPinOption,
} from "../runtime/auto-pin.js";
import { feature } from "../lib/feature-flags.js";
import { recordCompressionMetric } from "../lib/compression-telemetry.js";
import {
  fireSessionHook,
  fireUserPromptSubmit,
  fireAssistantResponse,
  fireSessionStop,
  fireNotification,
} from "../lib/session-hooks.js";
import { HookEvents } from "../lib/hook-manager.js";
import { IterationBudget } from "../lib/iteration-budget.js";
import { resolveAgentMcp } from "../runtime/mcp-config.js";
import { mergeConsecutiveMessages } from "../runtime/message-roles.js";
import {
  AGENT_TOOLS,
  buildSystemPrompt,
  chatWithTools,
  executeTool as coreExecuteTool,
  agentLoop as coreAgentLoop,
  formatToolArgs,
  killAllBackgroundShellTasks,
  killBackgroundShellTask,
  listBackgroundShellTasks,
} from "../runtime/agent-core.js";
import { formatBackgroundTasks } from "./tasks-status.js";
import { expandFileRefsAsync } from "../runtime/file-ref-expander.js";
import { prepareVisionTurn, resolveVisionLlm } from "../lib/image-input.js";
import { composeSystemPrompt } from "../runtime/system-prompt.js";
import { installPipeSafety } from "../runtime/pipe-safety.js";
import { installOutputBackpressure } from "../runtime/output-backpressure.js";
import {
  makeFallbackChatFn,
  normalizeFallbackModels,
} from "../runtime/fallback-model.js";
import { resolveSlashMacro } from "./slash-macro.js";
import { expandMcpPrompt, renderMcpSurface } from "./mcp-prompt.js";
import { newCostStore, addUsage } from "./session-cost.js";
import { extractPluginUsageAttribution } from "../lib/plugin-usage-attribution.js";
import { formatManagedCheckpointEvent } from "../lib/managed-checkpoint-render.js";
import { parseThinkCommand, parseEffortCommand } from "./think-command.js";
import {
  parseBtwCommand,
  parseNoteNextCommand,
  runBtwQuestion,
  buildAsideBlock,
  applyAside,
} from "./btw-command.js";
import { shouldStreamLive } from "./stream-decision.js";
import { emptyTurnNotice } from "./empty-turn-notice.js";
import {
  createPromptInteractionSurface,
  mergeClipboardImageChips,
} from "./prompt-interactions.js";
import {
  isReadlineWordRuboutKey,
  readlineWordRubout,
  resolveReplKeybindingFlavor,
} from "./repl-keybindings.js";
import { createSystemClipboardImageBinding } from "./clipboard-image.js";
import {
  buildPermissionPrompt,
  resolveAskIdleTimeoutMs,
  questionWithIdleTimeout,
} from "./permission-prompt.js";
import { describeAskContext, raceLocalAndRemote } from "./remote-approval.js";
import { runWithHostHooksV2Workspace } from "../lib/hooks-v2-workspace-context.js";
import {
  parsePermissionTier,
  parsePermissionModeArg,
  permissionModeForTier,
  describeTier,
  nextTier,
} from "./permission-tier.js";

export const REPL_RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE =
  "CC_RUNTIME_USAGE_LEDGER_FAILED: runtime usage telemetry was not durably persisted; restart this session";

/** One fail-closed latch is created for each REPL process/session host. */
export function createReplRuntimeLedgerTerminalLatch(options = {}) {
  const onTrip = typeof options.onTrip === "function" ? options.onTrip : null;
  let terminalError = null;
  return Object.freeze({
    trip(error) {
      if (terminalError) return terminalError;
      if (error?.runtimeLedgerPersistence !== true) return null;
      terminalError = new Error(
        REPL_RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE,
        { cause: error },
      );
      terminalError.code = "CC_RUNTIME_USAGE_LEDGER_FAILED";
      terminalError.runtimeLedgerPersistence = true;
      try {
        onTrip?.(terminalError);
      } catch {
        // Terminal state must survive a best-effort host notification failure.
      }
      return terminalError;
    },
    assertOpen() {
      if (terminalError) throw terminalError;
    },
    isTripped() {
      return terminalError !== null;
    },
    error() {
      return terminalError;
    },
  });
}

/** Persisted sessions may only use the deterministic local suggestion engine. */
export function resolveReplPromptSuggestionGenerator(useJsonl, generator) {
  return useJsonl ? undefined : generator;
}

export function resolveReplMeteredSessionId(useJsonl, sessionId) {
  return useJsonl && sessionId ? sessionId : null;
}

export function combineReplSignals(...signals) {
  const active = [...new Set(signals.filter(Boolean))];
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

export async function closeReplSessionBudgetRootScope(scope) {
  const root = scope?.root || null;
  if (!root) return false;
  const closed = await root.close();
  scope.root = null;
  return closed;
}

function releaseReplSessionHostLeaseScope(scope) {
  const lease = scope?.lease || null;
  if (!lease) return false;
  const released = lease.release?.();
  scope.lease = null;
  return released;
}

function attachReplCompactionLedgerMetadata(error, callId, settled) {
  let target = error;
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    target = new Error("semantic compaction provider call failed", {
      cause: error,
    });
  }
  try {
    Object.defineProperties(target, {
      compactionCallId: {
        configurable: true,
        value: callId || undefined,
      },
      usageLedgerSettled: {
        configurable: true,
        value: settled === true,
      },
    });
    return target;
  } catch {
    const wrapped = new Error("semantic compaction provider call failed", {
      cause: error,
    });
    Object.defineProperties(wrapped, {
      compactionCallId: {
        configurable: true,
        value: callId || undefined,
      },
      usageLedgerSettled: {
        configurable: true,
        value: settled === true,
      },
    });
    return wrapped;
  }
}

function asReplRuntimeLedgerPersistenceError(error, message) {
  if (error && (typeof error === "object" || typeof error === "function")) {
    try {
      const marked = markRuntimeLedgerPersistenceError(error);
      if (marked?.runtimeLedgerPersistence === true) return marked;
    } catch {
      // Frozen/non-extensible errors are wrapped below.
    }
  }
  const wrapped = new Error(message, { cause: error });
  return markRuntimeLedgerPersistenceError(wrapped);
}

/** Meter one direct REPL call and expose only secret-free ledger metadata. */
export async function runReplMeteredModelCallWithLedger({
  sessionId,
  persist,
  provider,
  model,
  source = "model",
  sessionBudget = null,
  call,
  attachErrorMetadata = false,
}) {
  let callId = null;
  let usageLedgerSettled = false;
  try {
    const result = await runMeteredDirectModelCall({
      sessionId,
      persist: sessionId
        ? async (type, data) => {
            await persist(type, data);
            if (type === "model_usage_started") callId = data.callId;
            else usageLedgerSettled = true;
          }
        : null,
      provider,
      model,
      source,
      sessionBudget,
      call,
    });
    return Object.freeze({ result, callId, usageLedgerSettled });
  } catch (error) {
    if (attachErrorMetadata) {
      throw attachReplCompactionLedgerMetadata(
        error,
        callId,
        usageLedgerSettled,
      );
    }
    throw error;
  }
}

/**
 * Execute a REPL-owned direct tool surface behind the same durable call ledger
 * used by the main agent loop. `/auto` and `/plan execute` do not yield
 * `tool-executing` / `tool-result` events, so their host must bracket the real
 * execution here instead of relying on the loop wrapper.
 */
export async function runReplDirectToolWithLedger({
  sessionId = null,
  tool,
  args,
  execute,
  persistStarted = appendEvent,
  persistSettlement = appendToolCallCompact,
  now = Date.now,
  callId,
  terminalLatch = null,
}) {
  if (typeof execute !== "function") {
    throw new TypeError("direct REPL tool execution requires an executor");
  }
  terminalLatch?.assertOpen();
  const id = runtimeToolCallId(callId);
  if (sessionId) {
    try {
      await persistStarted(sessionId, "tool_call_started", { id, tool });
    } catch (error) {
      const persistenceError = asReplRuntimeLedgerPersistenceError(
        error,
        "direct REPL tool start was not durable",
      );
      throw terminalLatch?.trip(persistenceError) || persistenceError;
    }
  }

  const startedAt = now();
  let result;
  let executionError;
  let executionFailed = false;
  try {
    result = await execute(tool, args);
  } catch (error) {
    executionFailed = true;
    executionError = error;
  }

  const observedDuration = result?.toolTelemetryRecord?.durationMs;
  const durationMs =
    observedDuration ?? Math.max(0, Number(now()) - Number(startedAt));
  if (sessionId) {
    try {
      await persistSettlement(sessionId, {
        id,
        tool,
        isError: Boolean(
          executionFailed ||
          result?.error ||
          result?.is_error ||
          result?.isError,
        ),
        skill: tool === "run_skill" ? args?.skill_name : undefined,
        ...extractPluginUsageAttribution(result),
        durationMs,
      });
    } catch (error) {
      const persistenceError = asReplRuntimeLedgerPersistenceError(
        error,
        "direct REPL tool settlement was not durable",
      );
      throw terminalLatch?.trip(persistenceError) || persistenceError;
    }
  }

  if (executionFailed) {
    throw terminalLatch?.trip(executionError) || executionError;
  }
  return result;
}

/**
 * Reference to the runtime DB for hook execution (set during startAgentRepl)
 */
let _hookDb = null;
let _compressor = null;
let _approvalGate = null;
// Static + CLI-owned scoped permission rules (deny > ask > allow) and an
// interactive confirmer for `ask` matches. Scoped rules are refreshed at each
// tool boundary so TTL expiry and external revocation affect a live session.
let _permissionRules = null;
let _permissionRulesProvider = null;
let _permissionConfirm = null;
let _managedPermissionRulesOnly = false;
// .claude/settings.json `hooks` block (decision-capable PreToolUse/PostToolUse).
let _settingsHooks = null;
// Installed-plugin background monitors (Phase 3.3i) — a supervisor owning any
// long-running/interval watcher processes a trusted plugin declared; reaped in
// the SessionEnd cleanup so nothing outlives the REPL.
let _pluginMonitors = null;
// Installed-plugin `bin` PATH injection (Phase 3.3n) — restore() puts PATH back
// at SessionEnd so plugin executables are only resolvable during the session.
let _pluginBinRestore = null;
// Installed-plugin `settings` default env (Phase 3.3o) — restore() removes the
// plugin-provided env-var defaults at SessionEnd (session-scoped).
let _pluginSettingsRestore = null;
// Async settings-hook supervisor (Phase 6) — owns fire-and-forget `async:true`
// hook processes; their results/rewakes drain into the next turn's context.
// Lazily created when the first async hook is dispatched; reaped at SessionEnd.
let _asyncHookSupervisor = null;
// .claude/settings.json `respondToBashCommands` (Claude-Code 2.1.186): whether a
// `!command` auto-triggers an assistant response to its output. undefined =
// unset → defaults OFF (opt-in) in shouldRespondToBashCommands.
let _respondToBash;
// .claude/settings.json `autoMode.classifyAllShell` (Claude-Code 2.1.193): route
// the built-in verification allowlist through the shell-policy classifier (→
// ApprovalGate confirm) instead of fast-pathing it. false = unset → off.
let _classifyAllShell = false;
let _sandbox = null;
// Bounded log of tool calls the agent was BLOCKED from running this session
// (shell-policy / ApprovalGate / settings rule / hook). Surfaced by
// `/permissions denials` and mirrored to `cc permissions recent`.
const _recentDenials = [];

function persistRecentDenial(record, options = {}) {
  try {
    appendRecentDenials(record, {
      sessionId: options.sessionId,
      permissionMode: options.permissionMode,
      cwd: options.cwd || process.cwd(),
      source: "repl",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fire settings.json Notification hooks (observe-only) — the agent needs the
 * user's attention (e.g. waiting on a permission/risk confirmation). A hook can
 * ring a bell / send a desktop notification. Best-effort, never blocks.
 */
async function _fireNotification(message, type = "info", session = null) {
  // Fire settings.json observe hooks first (best-effort)
  if (_settingsHooks) {
    try {
      const { runObserveHooks } =
        await import("../lib/settings-hook-events.js");
      runObserveHooks(
        _settingsHooks,
        "Notification",
        {
          message,
          type,
          cwd: process.cwd(),
          session_id: session?.sessionId || null,
        },
        { cwd: process.cwd() },
      );
    } catch (_err) {
      // observe-only — never affect the prompt
    }
  }
  // Fire database-registered Notification hooks (interceptable/suppressible)
  if (session) {
    try {
      const result = await fireNotification(_hookDb, message, {
        session,
        type,
      });
      if (result?.directive?.suppress) {
        return { suppress: true };
      }
      if (result?.directive?.message) {
        return { message: result.directive.message };
      }
    } catch (_err) {
      // ignore hook errors
    }
  }
  return { message };
}
/**
 * "Always allow" persistence: derive a sensible allow rule for a tool call,
 * append it to .claude/settings.local.json (personal, gitignored), and reflect
 * it in the in-memory ruleset so the rest of the session stops prompting. A
 * persisted `allow` short-circuits the ApprovalGate via agent-core's
 * `ruleAllowed` path (see permission-rules wiring). Returns {rule,file} or null.
 */
async function _persistAlwaysAllow(tool, args) {
  try {
    if (_managedPermissionRulesOnly) {
      process.stderr.write(
        "  always-allow is disabled by managed settings; ask your administrator to change the policy.\n",
      );
      return null;
    }
    const rulesMod = await import("../lib/permission-rules.cjs");
    const { suggestAllowRule } = rulesMod.default || rulesMod;
    const rule = suggestAllowRule(tool || "run_shell", args || {});
    if (!rule) return null;
    const { addRule } = await import("../lib/settings-loader.cjs");
    const { file } = addRule({
      cwd: process.cwd(),
      kind: "allow",
      rule,
      scope: "local",
    });
    if (!_permissionRules) _permissionRules = { allow: [], ask: [], deny: [] };
    if (!_permissionRules.allow.includes(rule))
      _permissionRules.allow.push(rule);
    return { rule, file };
  } catch (err) {
    process.stderr.write(`  always-allow persist failed: ${err.message}\n`);
    return null;
  }
}

/**
 * Execute a tool call — delegates to agent-core with REPL's hookDb and cwd.
 */
async function executeTool(name, args, context = {}) {
  return coreExecuteTool(name, args, {
    hookDb: _hookDb,
    cwd: process.cwd(),
    approvalGate: _approvalGate,
    permissionRules: _permissionRules,
    permissionRulesProvider: _permissionRulesProvider,
    permissionConfirm: _permissionConfirm,
    settingsHooks: _settingsHooks,
    classifyAllShell: _classifyAllShell,
    sandbox: _sandbox,
    sessionId: context.sessionId || null,
    sessionBudget: context.sessionBudget || null,
    signal: context.signal || null,
  });
}

/**
 * Agentic loop — wraps agent-core's async generator with REPL display output.
 * Exported so its event-translation contract (checkpoint-mark accuracy for
 * `/rewind`, content/usage extraction, forced-off in-loop compaction) is
 * unit-testable via the `options._coreLoop` injection seam.
 */
export async function agentLoop(messages, options) {
  const writeOut =
    options.writeOut || ((text) => process.stdout.write(String(text)));
  const waitForOutput = options.waitForOutput;
  const persistBoundary = options._appendUsageBoundary || appendEvent;
  const persistTokenUsage = options._appendTokenUsage || appendTokenUsage;
  const persistToolCall =
    options._appendToolCallCompact || appendToolCallCompact;
  const persistRuntimeLedger = (action) => {
    try {
      return action();
    } catch (error) {
      throw markRuntimeLedgerPersistenceError(error);
    }
  };
  // Resume-degenerate role merge (Claude Code 2.1.187 parity), gated by the
  // one-shot `mergeRoles` flag so it fires only on the first model call after
  // resuming a session whose prior run produced no assistant response. Collapse
  // IN PLACE: `coreAgentLoop` mutates this same array (appending assistant/tool
  // turns), and the REPL reuses it across turns, so folding a copy would leave
  // the degenerate `[user, user]` pair in the persistent history and re-break
  // the next turn. The tail helper validates the complete raw transcript first
  // and folds only an exact plain `{role, content}` pair, so recovery authority
  // can never disappear during this live one-shot normalization.
  if (options.mergeRoles) {
    collapseValidatedPlainReplTailInPlace(messages);
  }
  const usageEvents = [];
  // Visible cross-vendor fallback notice: a silent switch from the configured
  // provider onto another vendor (or a baseUrl relabel) is surfaced as a yellow
  // line, so "configured X but it ran Y" never happens quietly. Callers may
  // override; default prints to the REPL.
  const onProviderFallback =
    options.onProviderFallback ||
    ((info) =>
      writeOut(
        chalk.yellow(
          `\n  ⚠️  ${info.message || `已从 "${info.from}" 切换到 "${info.to}"`}\n`,
        ),
      ));
  // `_coreLoop` is an injectable seam (defaults to agent-core's loop) so the
  // wrapper's event translation can be unit-tested without a live model.
  const runCoreLoop = options._coreLoop || coreAgentLoop;
  const onUsageBoundary =
    options.onUsageBoundary ||
    (options.persistUsageTelemetry === true && options.sessionId
      ? (event) => {
          persistRuntimeLedger(() =>
            persistBoundary(
              options.sessionId,
              runtimeUsageEventType("started"),
              projectRuntimeUsageBoundary(event, "started"),
            ),
          );
        }
      : undefined);
  const onUsageSettlement =
    options.onUsageSettlement ||
    (options.persistUsageTelemetry === true && options.sessionId
      ? (event) => {
          if (event?.type === "token-usage") {
            persistRuntimeLedger(() =>
              persistTokenUsage(
                options.sessionId,
                projectRuntimeTokenUsage(event),
              ),
            );
            return;
          }
          persistRuntimeLedger(() =>
            persistBoundary(
              options.sessionId,
              runtimeUsageEventType("unknown"),
              projectRuntimeUsageBoundary(
                event?.type === "compaction-usage-unknown"
                  ? {
                      ...event,
                      code: event.code || "provider_transport_outcome_unknown",
                    }
                  : event,
                "unknown",
              ),
            ),
          );
        }
      : undefined);
  const childToolExecs = new Map();
  const onToolCallBoundary =
    options.onToolCallBoundary ||
    (options.persistUsageTelemetry === true && options.sessionId
      ? (event) => {
          const id = runtimeToolCallId(event?.tool_use_id);
          childToolExecs.set(id, {
            tool: event?.tool || "?",
            startedAt: options.now ? options.now() : Date.now(),
          });
          persistRuntimeLedger(() =>
            persistBoundary(options.sessionId, "tool_call_started", {
              id,
              tool: event?.tool || "?",
            }),
          );
        }
      : undefined);
  const onToolCallSettlement =
    options.onToolCallSettlement ||
    (options.persistUsageTelemetry === true && options.sessionId
      ? (event) => {
          const id = runtimeToolCallId(event?.tool_use_id);
          const started = childToolExecs.get(id);
          childToolExecs.delete(id);
          persistRuntimeLedger(() =>
            persistToolCall(options.sessionId, {
              id,
              tool: event?.tool || started?.tool || "?",
              isError: Boolean(event?.error || event?.result?.error),
              skill: event?.attribution?.skill,
              durationMs: started
                ? Math.max(
                    0,
                    (options.now ? options.now() : Date.now()) -
                      started.startedAt,
                  )
                : undefined,
            }),
          );
        }
      : undefined);
  // Tool results carry a stable provider id. Keep every in-flight call keyed by
  // that id because read-only batches may expose all starts before any result.
  const _activeExecs = new Map();
  const _unsettledExecs = [];
  // The core loop runs tools serially. A classified non-MCP side effect stays
  // live from its yielded `tool-executing` boundary until the matching result.
  let _currentSideEffectOpId = null;
  for await (const event of runCoreLoop(messages, {
    ...options,
    // FORCE in-loop compaction off — the REPL runs its OWN post-turn compaction
    // (with metrics + persisted compact events), so letting agent-core compact
    // too would trim the same history twice. Placed AFTER the spread so a
    // caller's options.autoCompact can never silently re-enable the double pass.
    autoCompact: false,
    onUsageBoundary,
    onUsageSettlement,
    onToolCallBoundary,
    onToolCallSettlement,
    onProviderFallback,
  })) {
    // P1 explicit turn→checkpoint binding — the REPL as PRODUCER: fold every
    // loop event into the live table (checkpoint / tool / policy / child
    // agent), mirroring the headless runner's feed. Advisory: a feeder failure
    // must never disturb the turn. Absent by default → byte-identical.
    if (options.turnBindingFeed) {
      try {
        options.turnBindingFeed.handleEvent(event);
      } catch {
        /* advisory — never break the turn */
      }
    }
    const managedCheckpointLine = formatManagedCheckpointEvent(event);
    if (managedCheckpointLine) {
      const render =
        event.type === "managed-checkpoint-error" || event.coverage === "none"
          ? chalk.yellow
          : chalk.gray;
      writeOut(render(`${managedCheckpointLine}\n`));
    } else if (event.type === "checkpoint") {
      // Remember which file snapshot lines up with the live conversation so
      // `/rewind <n>` can restore code + conversation together (Claude-Code
      // parity). atMessageCount = messages.length at snapshot time; see
      // repl-rewind.js for how a turn is matched back to its checkpoint.
      if (Array.isArray(options.checkpointMarks)) {
        options.checkpointMarks.push({
          atMessageCount: messages.length,
          id: event.id,
          tool: event.tool,
        });
      }
      writeOut(
        chalk.gray(`  ⎌ checkpoint ${event.id} (before ${event.tool})\n`),
      );
    } else if (event.type === "tool-executing") {
      const exec = {
        id: runtimeToolCallId(event.tool_use_id),
        providerId: event.tool_use_id || null,
        tool: event.tool,
        args: event.args,
        startedAt: options.now ? options.now() : Date.now(),
      };
      _unsettledExecs.push(exec);
      if (exec.providerId) _activeExecs.set(exec.providerId, exec);
      if (options.persistUsageTelemetry === true && options.sessionId) {
        persistRuntimeLedger(() =>
          persistBoundary(options.sessionId, "tool_call_started", {
            id: exec.id,
            tool: event.tool,
          }),
        );
      }
      _currentSideEffectOpId = null;
      if (options.sideEffects) {
        const sideEffect = classifyToolSideEffect(event.tool, event.args);
        if (sideEffect) {
          const opId = options.sideEffects.nextOpId();
          _currentSideEffectOpId = opId;
          options.sideEffects.ledger
            .prepare(opId, {
              kind: sideEffect.kind,
              key: sideEffect.key,
              meta: {
                tool: event.tool,
                toolUseId: event.tool_use_id || null,
                turnId: event.turn_id || null,
                resources: collectToolResourceIdentifiers(
                  event.tool,
                  event.args,
                ),
                idempotencyKey: operationIdempotencyKey({
                  tool: event.tool,
                  args: event.args,
                }),
              },
            })
            .start(opId);
          // The generator has yielded before executing the tool. Persist the
          // started marker and recheck the host lease before resuming it.
          options.sideEffects.persist();
          options.sideEffects.assert?.();
        }
      }
      writeOut(
        chalk.gray(
          `  [${event.tool}] ${formatToolArgs(event.tool, event.args)}\n`,
        ),
      );
    } else if (event.type === "tool-result") {
      const exec =
        (event.tool_use_id ? _activeExecs.get(event.tool_use_id) : null) ||
        _unsettledExecs.find(
          (candidate) =>
            !candidate.settled &&
            (!event.tool || candidate.tool === event.tool),
        ) ||
        null;
      if (exec) {
        exec.settled = true;
        if (exec.providerId) _activeExecs.delete(exec.providerId);
        const activeIndex = _unsettledExecs.indexOf(exec);
        if (activeIndex >= 0) _unsettledExecs.splice(activeIndex, 1);
      }
      if (options.sideEffects && _currentSideEffectOpId) {
        const sideEffectError = event.error || event.result?.error || null;
        if (event.permission_decision) {
          options.sideEffects.ledger.annotate(_currentSideEffectOpId, {
            permissionDecision: event.permission_decision,
          });
        }
        if (sideEffectError) {
          options.sideEffects.ledger.fail(
            _currentSideEffectOpId,
            String(sideEffectError).slice(0, 200),
          );
        } else {
          options.sideEffects.ledger.commit(_currentSideEffectOpId);
        }
        options.sideEffects.persist();
        _currentSideEffectOpId = null;
      }
      const durationMs =
        event.result?.toolTelemetryRecord?.durationMs ??
        (exec?.tool === event.tool
          ? Math.max(
              0,
              (options.now ? options.now() : Date.now()) - exec.startedAt,
            )
          : undefined);
      // 用量归因: persist a compact tool_call record (name + error flag +
      // skill/plugin hints — never args, which can carry whole file bodies)
      // so `cc session usage --by tool|mcp|plugin` and `cc insights` can
      // aggregate tool use for REPL sessions. Best-effort; opt out with
      // options.persistToolCalls === false.
      if (options.sessionId && options.persistToolCalls !== false) {
        try {
          persistToolCall(options.sessionId, {
            id: exec?.id,
            tool: event.tool,
            isError: Boolean(event.error || event.result?.error),
            skill:
              event.tool === "run_skill" && exec?.tool === "run_skill"
                ? exec.args?.skill_name
                : undefined,
            ...extractPluginUsageAttribution(event.result),
            durationMs,
          });
        } catch (_e) {
          if (options.persistUsageTelemetry === true) {
            throw markRuntimeLedgerPersistenceError(_e);
          }
          // Legacy non-JSONL persistence remains best-effort.
        }
      }
      if (event.error || event.result?.error) {
        writeOut(chalk.red(`  Error: ${event.error || event.result?.error}\n`));
        // Record policy denials (not plain tool failures) into the caller's
        // denial log for review via `/permissions denials` (Claude-Code 2.1.193
        // recent denials). Caller passes the session log (mirrors checkpointMarks)
        // so the wrapper stays unit-testable.
        if (Array.isArray(options.denialLog)) {
          const denial = classifyDenial({
            tool: event.tool,
            result: event.result,
            error: event.error,
            argsSummary:
              exec && exec.tool === event.tool
                ? formatToolArgs(event.tool, exec.args)
                : "",
          });
          if (denial) {
            const record = { ...denial, at: Date.now() };
            recordDenial(options.denialLog, record);
            if (options.persistRecentDenials === true) {
              persistRecentDenial(record, {
                sessionId: options.sessionId,
                permissionMode: options.permissionMode,
                cwd: options.cwd,
              });
            }
          }
        }
        // Parity with Desktop AIChatPage's `Switch to Trusted` button:
        // when the deny came from ApprovalGate (not shell-policy), surface
        // the exact CLI command the user can run to relax the per-session
        // policy. The structured `approval` outcome is attached by
        // `evaluateShellCommandWithApproval` in agent-core.js.
        const approval = event.result?.approval;
        if (approval?.decision === "deny" && approval?.via !== "shell-policy") {
          const sid = options?.sessionId;
          const policy = approval.policy || "strict";
          if (sid && policy === "strict") {
            writeOut(
              chalk.yellow(
                `  Hint: relax policy with  cc session policy ${sid} --set trusted\n`,
              ),
            );
          } else if (sid) {
            writeOut(
              chalk.yellow(
                `  Hint: per-session policy is "${policy}" — see  cc session policy ${sid}\n`,
              ),
            );
          }
        }
      } else if (event.result?.success) {
        writeOut(chalk.green(`  Done\n`));
      }
    } else if (event.type === "thinking") {
      // Intermediate-step reasoning (before a tool call) — dimmed, inline.
      if (process.env.CC_REPL_THINKING !== "0" && event.text) {
        writeOut(
          "\n" + chalk.dim("💭 " + event.text.replace(/\n/g, "\n   ")) + "\n",
        );
      }
    } else if (event.type === "token-usage") {
      usageEvents.push(event);
      if (
        event.ledgerPersisted !== true &&
        options.persistUsageTelemetry === true &&
        options.sessionId
      ) {
        persistRuntimeLedger(() =>
          persistTokenUsage(options.sessionId, projectRuntimeTokenUsage(event)),
        );
      }
      recordSessionBudgetUsage(
        options.sessionBudget,
        event,
        "REPL usage settlement",
      );
    } else if (
      event.type === "model-usage-started" ||
      event.type === "model-usage-unknown" ||
      event.type === "compaction-usage-unknown"
    ) {
      if (
        event.ledgerPersisted !== true &&
        options.persistUsageTelemetry === true &&
        options.sessionId
      ) {
        const outcome =
          event.type === "model-usage-started" ? "started" : "unknown";
        persistRuntimeLedger(() =>
          persistBoundary(
            options.sessionId,
            runtimeUsageEventType(outcome),
            projectRuntimeUsageBoundary(
              event.type === "compaction-usage-unknown"
                ? {
                    ...event,
                    code: event.code || "provider_transport_outcome_unknown",
                  }
                : event,
              outcome,
            ),
          ),
        );
      }
      if (event.type === "model-usage-started") {
        beginSessionBudgetUsage(
          options.sessionBudget,
          event,
          "REPL provider call",
        );
      } else if (markSessionBudgetUsageUnknown(options.sessionBudget, event)) {
        rejectSessionBudgetUsageUnknown(event, "REPL provider call");
      }
    } else if (event.type === "iteration-warning") {
      writeOut(chalk.yellow(`\n  ${event.message}\n`));
    } else if (event.type === "iteration-budget-exhausted") {
      writeOut(chalk.red(`\n  [Budget Exhausted] ${event.budget}\n`));
    } else if (event.type === "response-complete") {
      await waitForOutput?.();
      return { content: event.content, usageEvents, thinking: event.thinking };
    }
    await waitForOutput?.();
  }
  return { content: "", usageEvents };
}

const REPL_MCP_RECOVERY_CANDIDATES = new WeakSet();
const REPL_JSONL_RESUME_CANDIDATES = new WeakSet();
const REPL_JSONL_RESUME_ABSENCE_CANDIDATES = new WeakSet();
const REPL_NATIVE_PROMISE = Promise;
const REPL_NATIVE_PROMISE_PROTOTYPE = Promise.prototype;
const REPL_NATIVE_PROMISE_THEN = Promise.prototype.then;
const REPL_NATIVE_PROMISE_CONSTRUCTOR_DESCRIPTOR = Object.freeze({
  ...Object.getOwnPropertyDescriptor(Promise.prototype, "constructor"),
});
const REPL_NATIVE_PROMISE_SPECIES_DESCRIPTOR = Object.freeze({
  ...Object.getOwnPropertyDescriptor(Promise, Symbol.species),
});
const REPL_SAFE_PROMISE_CONSTRUCTOR = Object.freeze(
  Object.defineProperty(Object.create(null), Symbol.species, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: null,
  }),
);
const REPL_NATIVE_PROMISE_REJECTION_HANDLER = () => {};
const REPL_PAYLOAD_DIGEST = /^sha256:[0-9a-f]{64}$/;
const REPL_AUTHORITY_HASH = /^[0-9a-f]{64}$/;
const REPL_RESUME_SESSION_ID_MAX_BYTES = 128;
const REPL_RESUME_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;
const REPL_WINDOWS_DEVICE_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const REPL_RESUME_ROLES = new Set(["system", "user", "assistant", "tool"]);
const REPL_MCP_EFFECTS = new Set(["read", "unknown", "write", "destructive"]);
const REPL_REPLAY_DENY_FIELDS = new Set([
  "ledgerId",
  "serverName",
  "toolName",
  "inputBytes",
  "replayDigest",
]);
const REPL_MCP_REMEDIATIONS = new Set([
  "inspect_transcript",
  "adjudicate_started_calls",
  "exact_replay_denied",
]);

function invalidReplRecovery(message, code = MCP_RECOVERY_INVALID_CODE) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function validateReplResumeSessionId(sessionId) {
  if (
    isUnsafeSessionId(sessionId) ||
    Buffer.byteLength(sessionId, "utf8") > REPL_RESUME_SESSION_ID_MAX_BYTES ||
    !REPL_RESUME_SESSION_ID_PATTERN.test(sessionId) ||
    REPL_WINDOWS_DEVICE_NAME.test(sessionId) ||
    sessionId.endsWith(".") ||
    sessionId.normalize("NFC") !== sessionId
  ) {
    throw invalidReplRecovery(
      "REPL resume session id is invalid",
      "CC_REPL_SESSION_ID_INVALID",
    );
  }
  return sessionId;
}

function brandedFrozenCandidate(brand, value) {
  const candidate = Object.freeze(value);
  brand.add(candidate);
  return candidate;
}

function safeRecoveryErrorValue(error, key, fallback) {
  try {
    if (error && !isProxy(error)) {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      if (descriptor && "value" in descriptor) return descriptor.value;
    }
  } catch {
    // Malformed errors are diagnostic input, never recovery authority.
  }
  return fallback;
}

function replMcpRecoveryError(error, fallbackCode) {
  const message = safeRecoveryErrorValue(
    error,
    "message",
    "REPL session recovery failed",
  );
  let cause = new Error("REPL session recovery failed");
  try {
    if (!isProxy(error) && error instanceof Error) cause = error;
  } catch {
    // Keep the inert fallback cause for hostile diagnostic objects.
  }
  const wrapped = new Error(
    typeof message === "string" && message
      ? message
      : "REPL session recovery failed",
    { cause },
  );
  const code = safeRecoveryErrorValue(error, "code", fallbackCode);
  wrapped.code = typeof code === "string" && code ? code : fallbackCode;
  return wrapped;
}

function samePropertyDescriptor(actual, expected) {
  if (!actual || !expected) return actual === expected;
  if (
    actual.configurable !== expected.configurable ||
    actual.enumerable !== expected.enumerable
  ) {
    return false;
  }
  if ("value" in expected) {
    return (
      "value" in actual &&
      actual.value === expected.value &&
      actual.writable === expected.writable
    );
  }
  return (
    !("value" in actual) &&
    actual.get === expected.get &&
    actual.set === expected.set
  );
}

function unconsumableNativePromise(subject) {
  return invalidReplRecovery(
    `${subject} is a native Promise with an unsafe non-configurable constructor; ` +
      "its producer must observe the rejection",
    "CC_REPL_NATIVE_PROMISE_UNCONSUMABLE",
  );
}

function consumeNativeReplPromise(value, subject) {
  const prototype = Object.getPrototypeOf(value);
  if (isProxy(prototype)) throw unconsumableNativePromise(subject);

  const constructorDescriptor = Object.getOwnPropertyDescriptor(
    value,
    "constructor",
  );
  const intrinsicSpeciesIntact = samePropertyDescriptor(
    Object.getOwnPropertyDescriptor(REPL_NATIVE_PROMISE, Symbol.species),
    REPL_NATIVE_PROMISE_SPECIES_DESCRIPTOR,
  );
  const inheritedIntrinsicConstructor =
    !constructorDescriptor &&
    prototype === REPL_NATIVE_PROMISE_PROTOTYPE &&
    samePropertyDescriptor(
      Object.getOwnPropertyDescriptor(
        REPL_NATIVE_PROMISE_PROTOTYPE,
        "constructor",
      ),
      REPL_NATIVE_PROMISE_CONSTRUCTOR_DESCRIPTOR,
    ) &&
    intrinsicSpeciesIntact;
  const ownIntrinsicConstructor =
    constructorDescriptor &&
    "value" in constructorDescriptor &&
    (constructorDescriptor.value === undefined ||
      (constructorDescriptor.value === REPL_NATIVE_PROMISE &&
        intrinsicSpeciesIntact));

  if (inheritedIntrinsicConstructor || ownIntrinsicConstructor) {
    Reflect.apply(REPL_NATIVE_PROMISE_THEN, value, [
      undefined,
      REPL_NATIVE_PROMISE_REJECTION_HANDLER,
    ]);
    return;
  }

  const canShadow = constructorDescriptor
    ? constructorDescriptor.configurable === true
    : Object.isExtensible(value);
  if (!canShadow) {
    // Promise.prototype.then necessarily performs SpeciesConstructor, which
    // would execute this hostile constructor/accessor. ECMAScript exposes no
    // separate hook-free operation that marks a rejection handled. Fail closed
    // without pretending the Promise was consumed; the producer must have
    // attached its own rejection observer before returning this invalid value.
    throw unconsumableNativePromise(subject);
  }

  Object.defineProperty(value, "constructor", {
    configurable: true,
    enumerable: constructorDescriptor?.enumerable ?? false,
    writable: false,
    value: REPL_SAFE_PROMISE_CONSTRUCTOR,
  });
  try {
    Reflect.apply(REPL_NATIVE_PROMISE_THEN, value, [
      undefined,
      REPL_NATIVE_PROMISE_REJECTION_HANDLER,
    ]);
  } finally {
    if (constructorDescriptor) {
      Object.defineProperty(value, "constructor", constructorDescriptor);
    } else {
      Reflect.deleteProperty(value, "constructor");
    }
  }
}

function synchronousReplRecoveryValue(value, subject) {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return value;
  }
  if (isProxy(value)) {
    throw invalidReplRecovery(`${subject} must not be a Proxy`);
  }

  // Consume a genuine Promise before inspecting any user-controlled `then`
  // descriptor. A Promise can shadow `then` with an accessor or data property;
  // reading that descriptor first would leave an already-rejected Promise
  // unobserved even though the recovery boundary correctly rejected it.
  if (isPromise(value)) {
    consumeNativeReplPromise(value, subject);
    throw invalidReplRecovery(`${subject} must be returned synchronously`);
  }

  let prototype = value;
  while (prototype) {
    // An ordinary object can hide a Proxy in its prototype chain. Check every
    // level before reflection so no getOwnPropertyDescriptor/getPrototypeOf
    // trap is executed while rejecting untrusted recovery evidence.
    if (isProxy(prototype)) {
      throw invalidReplRecovery(`${subject} must not inherit from a Proxy`);
    }
    const thenDescriptor = Object.getOwnPropertyDescriptor(prototype, "then");
    if (thenDescriptor) {
      if (!("value" in thenDescriptor)) {
        throw invalidReplRecovery(`${subject}.then must not be an accessor`);
      }
      if (typeof thenDescriptor.value === "function") {
        // Never invoke an arbitrary user-supplied thenable capability.
        throw invalidReplRecovery(`${subject} must be returned synchronously`);
      }
      break;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return value;
}

function plainDataDescriptors(value, subject) {
  synchronousReplRecoveryValue(value, subject);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidReplRecovery(`${subject} must be a plain data object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidReplRecovery(`${subject} must have a plain prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === "symbol" || !("value" in descriptors[key])) {
      throw invalidReplRecovery(`${subject} contains an accessor or symbol`);
    }
  }
  return descriptors;
}

function dataDescriptorValue(
  descriptors,
  key,
  subject,
  { required = true, fallback = null } = {},
) {
  const descriptor = descriptors[key];
  if (!descriptor) {
    if (!required) return fallback;
    throw invalidReplRecovery(`${subject}.${key} is missing`);
  }
  if (!("value" in descriptor)) {
    throw invalidReplRecovery(`${subject}.${key} must be a data property`);
  }
  return descriptor.value;
}

function snapshotDataArray(value, subject, mapper) {
  synchronousReplRecoveryValue(value, subject);
  if (!Array.isArray(value) || isProxy(value)) {
    throw invalidReplRecovery(`${subject} must be a non-Proxy array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === "symbol" || !("value" in descriptors[key])) {
      throw invalidReplRecovery(`${subject} contains an accessor or symbol`);
    }
  }
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw invalidReplRecovery(`${subject}.length is invalid`);
  }
  const snapshots = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) {
      throw invalidReplRecovery(`${subject}[${index}] is not plain data`);
    }
    snapshots.push(mapper(descriptor.value, index));
  }
  return Object.freeze(snapshots);
}

function requiredRecoveryString(value, subject, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || (!nullable && !value)) {
    throw invalidReplRecovery(`${subject} must be a string`);
  }
  return value;
}

function snapshotReplMcpRecord(record, index) {
  const subject = `MCP recovery unsettled[${index}]`;
  const descriptors = plainDataDescriptors(record, subject);
  const effectContract = dataDescriptorValue(
    descriptors,
    "effectContract",
    subject,
  );
  const effectDescriptors = plainDataDescriptors(
    effectContract,
    `${subject}.effectContract`,
  );
  const effect = requiredRecoveryString(
    dataDescriptorValue(
      effectDescriptors,
      "effect",
      `${subject}.effectContract`,
    ),
    `${subject}.effectContract.effect`,
  );
  if (!REPL_MCP_EFFECTS.has(effect)) {
    throw invalidReplRecovery(`${subject}.effectContract.effect is invalid`);
  }
  return Object.freeze({
    ledgerId: requiredRecoveryString(
      dataDescriptorValue(descriptors, "ledgerId", subject),
      `${subject}.ledgerId`,
    ),
    serverName: requiredRecoveryString(
      dataDescriptorValue(descriptors, "serverName", subject),
      `${subject}.serverName`,
    ),
    toolName: requiredRecoveryString(
      dataDescriptorValue(descriptors, "toolName", subject),
      `${subject}.toolName`,
    ),
    effectContract: Object.freeze({ effect }),
  });
}

function snapshotReplMcpIncident(incident, index) {
  const subject = `MCP recovery incidents[${index}]`;
  const descriptors = plainDataDescriptors(incident, subject);
  return Object.freeze({
    code: requiredRecoveryString(
      dataDescriptorValue(descriptors, "code", subject),
      `${subject}.code`,
    ),
    ledgerId: requiredRecoveryString(
      dataDescriptorValue(descriptors, "ledgerId", subject, {
        required: false,
        fallback: null,
      }),
      `${subject}.ledgerId`,
      { nullable: true },
    ),
  });
}

function snapshotReplReplayDeny(entry, index) {
  const subject = `MCP recovery replayDenied[${index}]`;
  const descriptors = plainDataDescriptors(entry, subject);
  const fields = Object.keys(descriptors);
  if (
    fields.length !== REPL_REPLAY_DENY_FIELDS.size ||
    fields.some((field) => !REPL_REPLAY_DENY_FIELDS.has(field))
  ) {
    throw invalidReplRecovery(`${subject} has an invalid exact schema`);
  }
  const snapshot = Object.freeze({
    ledgerId: requiredRecoveryString(
      dataDescriptorValue(descriptors, "ledgerId", subject),
      `${subject}.ledgerId`,
    ),
    serverName: requiredRecoveryString(
      dataDescriptorValue(descriptors, "serverName", subject),
      `${subject}.serverName`,
    ),
    toolName: requiredRecoveryString(
      dataDescriptorValue(descriptors, "toolName", subject),
      `${subject}.toolName`,
    ),
    inputBytes: dataDescriptorValue(descriptors, "inputBytes", subject),
    replayDigest: requiredRecoveryString(
      dataDescriptorValue(descriptors, "replayDigest", subject),
      `${subject}.replayDigest`,
    ),
  });
  if (
    !Number.isInteger(snapshot.inputBytes) ||
    snapshot.inputBytes < 0 ||
    !REPL_PAYLOAD_DIGEST.test(snapshot.replayDigest)
  ) {
    throw invalidReplRecovery(`${subject} has an invalid exact identity`);
  }
  return snapshot;
}

function strictReplMcpRecoverySnapshot(recovery, sessionId) {
  const descriptors = plainDataDescriptors(recovery, "MCP recovery");
  const recoverySessionId = requiredRecoveryString(
    dataDescriptorValue(descriptors, "sessionId", "MCP recovery"),
    "MCP recovery.sessionId",
  );
  if (recoverySessionId !== sessionId) {
    throw invalidReplRecovery("MCP recovery session does not match the target");
  }
  if (dataDescriptorValue(descriptors, "verified", "MCP recovery") !== true) {
    throw invalidReplRecovery("MCP recovery was not verified");
  }
  const unsettled = snapshotDataArray(
    dataDescriptorValue(descriptors, "unsettled", "MCP recovery"),
    "MCP recovery.unsettled",
    snapshotReplMcpRecord,
  );
  const incidents = snapshotDataArray(
    dataDescriptorValue(descriptors, "incidents", "MCP recovery"),
    "MCP recovery.incidents",
    snapshotReplMcpIncident,
  );
  // Exact-replay denies are authority, not presentation samples. Preserve and
  // freeze every entry: truncation would silently re-enable a denied call.
  const replayDenied = snapshotDataArray(
    dataDescriptorValue(descriptors, "replayDenied", "MCP recovery"),
    "MCP recovery.replayDenied",
    snapshotReplReplayDeny,
  );
  const headHash = requiredRecoveryString(
    dataDescriptorValue(descriptors, "headHash", "MCP recovery"),
    "MCP recovery.headHash",
    { nullable: true },
  );
  const recoveryDigest = requiredRecoveryString(
    dataDescriptorValue(descriptors, "recoveryDigest", "MCP recovery"),
    "MCP recovery.recoveryDigest",
  );
  const remediation = requiredRecoveryString(
    dataDescriptorValue(descriptors, "remediation", "MCP recovery"),
    "MCP recovery.remediation",
    { nullable: true },
  );
  if (
    (headHash !== null && !REPL_AUTHORITY_HASH.test(headHash)) ||
    !REPL_PAYLOAD_DIGEST.test(recoveryDigest) ||
    (remediation !== null && !REPL_MCP_REMEDIATIONS.has(remediation))
  ) {
    throw invalidReplRecovery("MCP recovery authority metadata is invalid");
  }
  const expectedRemediation =
    incidents.length > 0
      ? "inspect_transcript"
      : unsettled.length > 0
        ? "adjudicate_started_calls"
        : replayDenied.length > 0
          ? "exact_replay_denied"
          : null;
  if (remediation !== expectedRemediation) {
    throw invalidReplRecovery("MCP recovery remediation is inconsistent");
  }

  const snapshot = Object.freeze({
    sessionId: recoverySessionId,
    verified: true,
    unsettled,
    incidents,
    replayDenied,
    headHash,
    recoveryDigest,
    remediation,
  });
  const admission = classifyMcpRecoveryAdmission(snapshot);
  if (admission.reasonCode) {
    throw invalidReplRecovery(
      "MCP recovery projection is malformed",
      admission.reasonCode,
    );
  }
  return snapshot;
}

function dependencyDataFunction(dependencies, key, fallback) {
  if (dependencies == null) return fallback;
  if (typeof dependencies !== "object" || isProxy(dependencies)) {
    throw invalidReplRecovery("REPL recovery dependencies are invalid");
  }
  const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
  if (!descriptor) return fallback;
  if (!("value" in descriptor) || typeof descriptor.value !== "function") {
    throw invalidReplRecovery(`REPL recovery dependency ${key} is invalid`);
  }
  return descriptor.value;
}

function replMcpRecoveryFailureNotice(error, subject = "MCP call ledger") {
  return (
    `MCP recovery notice — the durable ${subject} could not be verified. ` +
    "Do not execute or retry MCP tools until the session transcript has " +
    `been inspected (${error?.code || "CC_MCP_LEDGER_EVENT_READ_FAILED"}).`
  );
}

function failClosedReplMcpRecoveryCandidate(
  sessionId,
  error,
  fallbackCode = "CC_MCP_LEDGER_EVENT_READ_FAILED",
  subject = "MCP call ledger",
) {
  const recoveryError = replMcpRecoveryError(error, fallbackCode);
  return brandedFrozenCandidate(REPL_MCP_RECOVERY_CANDIDATES, {
    sessionId,
    recovery: null,
    recoveryError,
    notice: replMcpRecoveryFailureNotice(recoveryError, subject),
  });
}

/**
 * Read one target session's verified MCP recovery projection without mutating
 * the active REPL. Callers commit the returned candidate only after the rest
 * of a session switch (notably message rebuild) has succeeded.
 */
export function readReplMcpRecoveryCandidate(sessionId, dependencies = {}) {
  try {
    const loadRecovery = dependencyDataFunction(
      dependencies,
      "loadMcpLedgerRecovery",
      loadMcpLedgerRecovery,
    );
    const formatNotice = dependencyDataFunction(
      dependencies,
      "formatMcpLedgerRecoveryNotice",
      formatMcpLedgerRecoveryNotice,
    );
    return createReplMcpRecoveryCandidate(
      sessionId,
      synchronousReplRecoveryValue(
        loadRecovery(sessionId),
        "MCP recovery loader result",
      ),
      formatNotice,
    );
  } catch (error) {
    return failClosedReplMcpRecoveryCandidate(sessionId, error);
  }
}

function createReplMcpRecoveryCandidate(
  sessionId,
  recoveryValue,
  formatNotice = formatMcpLedgerRecoveryNotice,
) {
  try {
    const recovery = strictReplMcpRecoverySnapshot(recoveryValue, sessionId);
    let notice = synchronousReplRecoveryValue(
      formatNotice(recovery),
      "MCP recovery formatter result",
    );
    if (notice !== null && typeof notice !== "string") {
      throw invalidReplRecovery(
        "MCP recovery formatter must return a string or null",
      );
    }
    if (
      !notice &&
      (recovery.unsettled.length > 0 ||
        recovery.incidents.length > 0 ||
        recovery.replayDenied.length > 0)
    ) {
      notice =
        "MCP recovery notice — interrupted MCP calls, ledger incidents, " +
        "or exact replay denies require explicit inspection before replay.";
    }
    return brandedFrozenCandidate(REPL_MCP_RECOVERY_CANDIDATES, {
      sessionId,
      recovery,
      recoveryError: null,
      notice: notice || null,
    });
  } catch (error) {
    return failClosedReplMcpRecoveryCandidate(sessionId, error);
  }
}

function snapshotReplMessageValue(value, subject, ancestors = new WeakSet()) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (!value || typeof value !== "object" || isProxy(value)) {
    throw invalidReplRecovery(
      `${subject} contains a non-serializable value`,
      "CC_REPL_SESSION_REBUILD_FAILED",
    );
  }
  if (ancestors.has(value)) {
    throw invalidReplRecovery(
      `${subject} contains a cycle`,
      "CC_REPL_SESSION_REBUILD_FAILED",
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return snapshotDataArray(value, subject, (item, index) =>
        snapshotReplMessageValue(item, `${subject}[${index}]`, ancestors),
      );
    }
    const descriptors = plainDataDescriptors(value, subject);
    const snapshot = {};
    for (const key of Object.keys(descriptors)) {
      snapshot[key] = snapshotReplMessageValue(
        descriptors[key].value,
        `${subject}.${key}`,
        ancestors,
      );
    }
    return Object.freeze(snapshot);
  } finally {
    ancestors.delete(value);
  }
}

function snapshotReplMessages(messages) {
  try {
    return snapshotDataArray(
      messages,
      "REPL session rebuild",
      (message, index) => {
        const snapshot = snapshotReplMessageValue(
          message,
          `REPL session rebuild[${index}]`,
        );
        if (
          !snapshot ||
          Array.isArray(snapshot) ||
          typeof snapshot.role !== "string"
        ) {
          throw invalidReplRecovery(
            `REPL session rebuild[${index}] is not a message`,
            "CC_REPL_SESSION_REBUILD_FAILED",
          );
        }
        return preserveDurableSystemMessageProvenance(message, snapshot);
      },
    );
  } catch (cause) {
    const error = invalidReplRecovery(
      safeRecoveryErrorValue(cause, "message", "REPL session rebuild failed"),
      "CC_REPL_SESSION_REBUILD_FAILED",
    );
    error.cause = cause;
    throw error;
  }
}

function canonicalPersistentReplMessages(messages) {
  return snapshotReplMessages(
    projectCanonicalResumeMessages(snapshotReplMessages(messages), {
      strict: true,
    }),
  );
}

/**
 * Track the exact replay projection this REPL has persisted. Compact writes
 * compare it with the store's verified active messages under one lock, so a
 * second host's unseen turn can never be hidden by a local auto/session-end
 * checkpoint.
 */
export function createReplCompactPersistence(
  initialMessages = [],
  dependencies = {},
) {
  const appendCompact = dependencyDataFunction(
    dependencies,
    "appendCompactEventIfMessagesMatch",
    appendCompactEventIfMessagesMatch,
  );
  let persistedMessages = canonicalPersistentReplMessages(initialMessages);
  const replace = (messages) => {
    persistedMessages = canonicalPersistentReplMessages(messages);
    return persistedMessages;
  };
  return Object.freeze({
    record(message) {
      const projected = canonicalPersistentReplMessages([message]);
      if (projected.length !== 1) {
        throw new TypeError("Persisted REPL message is not canonical");
      }
      persistedMessages = Object.freeze([...persistedMessages, projected[0]]);
      return projected[0];
    },
    replace,
    persist(sessionId, payload) {
      const canonicalMessages = canonicalPersistentReplMessages(
        payload?.messages || [],
      );
      const canonicalPayload = { ...payload, messages: canonicalMessages };
      const result = appendCompact(
        sessionId,
        canonicalPayload,
        persistedMessages,
      );
      synchronousReplRecoveryValue(result, "REPL compact settlement result");
      replace(canonicalMessages);
      return result;
    },
    snapshot() {
      return snapshotReplMessages(persistedMessages);
    },
  });
}

/**
 * Account one provider-backed REPL compaction and settle its canonical message
 * checkpoint before changing the live array. Provider work must already be
 * complete when this synchronous boundary is entered.
 */
export function settleReplCompactionCandidate({
  messages,
  expectedMessages,
  compacted,
  stats,
  trigger,
  useJsonl,
  sessionId,
  persistence,
  usageEvent = null,
  usageUnknownEvent = null,
  costStore = null,
  appendUsage = appendTokenUsage,
}) {
  if (usageUnknownEvent) {
    const block = Object.freeze({
      code: "CC_COMPACTION_USAGE_UNKNOWN",
      reason: usageUnknownEvent.reason || "provider_transport_outcome_unknown",
      commitState: "provider-usage-unknown",
      usageOutcome: "unknown",
    });
    if (
      useJsonl &&
      sessionId &&
      usageUnknownEvent.usageLedgerSettled !== true
    ) {
      const usagePersistenceError = asReplRuntimeLedgerPersistenceError(
        new Error("semantic compaction usage-unknown row was not durable"),
        "semantic compaction usage-unknown row was not durable",
      );
      return {
        applied: false,
        error: usagePersistenceError,
        usagePersistenceError,
        block,
      };
    }
    return {
      applied: false,
      block,
    };
  }

  if (usageEvent) {
    addUsage(costStore, [usageEvent]);
    if (useJsonl && sessionId && usageEvent.usageLedgerSettled !== true) {
      try {
        appendUsage(sessionId, {
          provider: usageEvent.provider,
          model: usageEvent.model,
          usage: usageEvent.usage,
          ...(usageEvent.callId ? { callId: usageEvent.callId } : {}),
          ...(usageEvent.source ? { source: usageEvent.source } : {}),
        });
      } catch (error) {
        const usagePersistenceError = asReplRuntimeLedgerPersistenceError(
          error,
          "semantic compaction token usage was not durable",
        );
        // The paid request is accounted in-memory exactly once, but compaction
        // and all later input must stop when the durable settlement is unknown.
        return {
          applied: false,
          error: usagePersistenceError,
          usagePersistenceError,
        };
      }
    }
  }

  const liveChanged =
    messages.length !== expectedMessages.length ||
    messages.some((message, index) => message !== expectedMessages[index]);
  if (liveChanged) {
    const error = new Error(
      "REPL messages changed while provider compaction was running",
    );
    error.code = "CC_COMPACTION_LOCAL_STATE_CHANGED";
    return { applied: false, error };
  }

  if (useJsonl && sessionId && stats?.strategy !== "none") {
    try {
      persistence.persist(sessionId, {
        ...stats,
        trigger: trigger || "manual",
        messages: compacted,
      });
    } catch (error) {
      return { applied: false, error };
    }
  }

  messages.length = 0;
  messages.push(...compacted);
  return { applied: true };
}

function validateRawReplReplayMessages(rebuiltMessages) {
  for (let index = 0; index < rebuiltMessages.length; index += 1) {
    const message = rebuiltMessages[index];
    if (!REPL_RESUME_ROLES.has(message.role)) {
      throw invalidReplRecovery(
        `REPL session message[${index}] has an unsupported role`,
        "CC_REPL_SESSION_ROLE_INVALID",
      );
    }

    const hasToolCalls = Object.prototype.hasOwnProperty.call(
      message,
      "tool_calls",
    );
    const hasToolCallId = Object.prototype.hasOwnProperty.call(
      message,
      "tool_call_id",
    );
    if (message.role !== "assistant" && hasToolCalls) {
      throw invalidReplRecovery(
        `REPL session message[${index}] carries tool calls on the wrong role`,
        "CC_REPL_SESSION_TOOL_PAIR_INVALID",
      );
    }
    if (message.role !== "tool" && hasToolCallId) {
      throw invalidReplRecovery(
        `REPL session message[${index}] carries a tool result id on the wrong role`,
        "CC_REPL_SESSION_TOOL_PAIR_INVALID",
      );
    }

    if (message.role === "tool") {
      if (
        !hasToolCallId ||
        typeof message.tool_call_id !== "string" ||
        message.tool_call_id.length === 0
      ) {
        throw invalidReplRecovery(
          `REPL session tool result[${index}] has an invalid call id`,
          "CC_REPL_SESSION_TOOL_PAIR_INVALID",
        );
      }
      continue;
    }

    if (message.role !== "assistant" || !hasToolCalls) continue;
    if (!Array.isArray(message.tool_calls)) {
      throw invalidReplRecovery(
        `REPL session assistant message[${index}] has invalid tool calls`,
        "CC_REPL_SESSION_TOOL_PAIR_INVALID",
      );
    }
    const batchToolCallIds = new Set();
    for (const toolCall of message.tool_calls) {
      const toolCallId =
        toolCall && typeof toolCall === "object" && !Array.isArray(toolCall)
          ? toolCall.id
          : null;
      if (
        typeof toolCallId !== "string" ||
        toolCallId.length === 0 ||
        batchToolCallIds.has(toolCallId)
      ) {
        throw invalidReplRecovery(
          `REPL session assistant message[${index}] has ambiguous tool call ids`,
          "CC_REPL_SESSION_TOOL_PAIR_INVALID",
        );
      }
      batchToolCallIds.add(toolCallId);
    }
  }
}

function isPlainReplMergeMessage(message) {
  if (message.role !== "user" && message.role !== "assistant") return false;
  const keys = Object.keys(message);
  return (
    Object.prototype.hasOwnProperty.call(message, "content") &&
    keys.every((key) => key === "role" || key === "content")
  );
}

function mergePlainReplRoleRuns(rebuiltMessages) {
  const mergedMessages = [];
  for (const message of rebuiltMessages) {
    const previous = mergedMessages.at(-1);
    if (
      previous &&
      previous.role === message.role &&
      isPlainReplMergeMessage(previous) &&
      isPlainReplMergeMessage(message)
    ) {
      // The shared role helper is safe only after raw authority validation and
      // only for exact {role, content} records. This prevents a later record's
      // tool/identity authority from disappearing behind object spread.
      mergedMessages[mergedMessages.length - 1] = mergeConsecutiveMessages([
        previous,
        message,
      ])[0];
    } else {
      mergedMessages.push(message);
    }
  }
  return snapshotReplMessages(mergedMessages);
}

function collapseValidatedPlainReplTailInPlace(messages) {
  const rawSnapshot = snapshotReplMessages(messages);
  validateRawReplReplayMessages(rawSnapshot);
  const previous = rawSnapshot.at(-2);
  const current = rawSnapshot.at(-1);
  if (
    !previous ||
    previous.role !== current?.role ||
    !isPlainReplMergeMessage(previous) ||
    !isPlainReplMergeMessage(current)
  ) {
    return false;
  }
  const merged = mergeConsecutiveMessages([previous, current]);
  if (merged.length !== 1) return false;
  messages.splice(messages.length - 2, 2, merged[0]);
  return true;
}

function normalizeReplReplayMessages(rebuiltMessages) {
  // Validate the immutable raw snapshot before any normalization. In
  // particular, never let a same-role merge hide malformed tool authority.
  validateRawReplReplayMessages(rebuiltMessages);

  // Stable-partition verified canonical systems ahead of conversation. Their
  // relative order is preserved exactly, without inspecting content. This
  // keeps a trailing migration/fork marker from separating a dangling user
  // turn from the next live user turn after providers extract system prompts.
  const canonicalSystemMessages = snapshotReplMessages(
    rebuiltMessages.filter((message) => message.role === "system"),
  );
  const conversationMessages = mergePlainReplRoleRuns(
    rebuiltMessages.filter((message) => message.role !== "system"),
  );
  let phase = "expect-initial-conversation-message";
  let pendingToolCallIds = null;

  for (let index = 0; index < conversationMessages.length; index += 1) {
    const message = conversationMessages[index];
    const hasToolCalls = Object.prototype.hasOwnProperty.call(
      message,
      "tool_calls",
    );

    if (message.role === "tool") {
      const toolCallId = message.tool_call_id;
      if (phase !== "expect-tools" || !pendingToolCallIds?.delete(toolCallId)) {
        throw invalidReplRecovery(
          `REPL session tool result[${index}] has no matching pending call`,
          "CC_REPL_SESSION_TOOL_PAIR_INVALID",
        );
      }
      if (pendingToolCallIds.size === 0) {
        pendingToolCallIds = null;
        phase = "expect-assistant-after-tools";
      }
      continue;
    }

    if (message.role === "user") {
      if (
        phase !== "expect-user" &&
        phase !== "expect-initial-conversation-message"
      ) {
        throw invalidReplRecovery(
          `REPL session user message[${index}] breaks role alternation`,
          "CC_REPL_SESSION_ROLE_ALTERNATION_INVALID",
        );
      }
      phase = "expect-assistant";
      continue;
    }

    if (
      phase !== "expect-assistant" &&
      phase !== "expect-assistant-after-tools" &&
      phase !== "expect-initial-conversation-message"
    ) {
      throw invalidReplRecovery(
        `REPL session assistant message[${index}] breaks role alternation`,
        "CC_REPL_SESSION_ROLE_ALTERNATION_INVALID",
      );
    }

    const toolCalls = hasToolCalls ? message.tool_calls : [];
    if (toolCalls.length === 0) {
      phase = "expect-user";
      continue;
    }

    // IDs are unique only within this pending assistant batch. A later, fully
    // settled fallback round may legitimately reuse a deterministic ID such as
    // call_<toolName>.
    pendingToolCallIds = new Set(toolCalls.map((toolCall) => toolCall.id));
    phase = "expect-tools";
  }

  if (phase === "expect-tools" || phase === "expect-assistant-after-tools") {
    throw invalidReplRecovery(
      "REPL session ends with an incomplete tool call/result exchange",
      "CC_REPL_SESSION_TOOL_PAIR_INVALID",
    );
  }
  return Object.freeze({
    canonicalSystemMessages,
    conversationMessages,
    replayMessages: Object.freeze([
      ...canonicalSystemMessages,
      ...conversationMessages,
    ]),
  });
}

function failedReplJsonlResumeCandidate(sessionId, error, sessionSnapshot) {
  const observedCode = safeRecoveryErrorValue(
    error,
    "code",
    "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
  );
  const resumeError = replMcpRecoveryError(
    error,
    typeof observedCode === "string" && observedCode
      ? observedCode
      : "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
  );
  return brandedFrozenCandidate(REPL_JSONL_RESUME_CANDIDATES, {
    ok: false,
    sessionId,
    rebuiltMessages: null,
    replayMessages: null,
    canonicalSystemMessages: null,
    conversationMessages: null,
    sessionSnapshot: sessionSnapshot || null,
    mcp: failClosedReplMcpRecoveryCandidate(
      sessionId,
      resumeError,
      resumeError.code,
      "session transcript",
    ),
    error: resumeError,
  });
}

function absentReplJsonlResumeCandidate(sessionId) {
  const error = new Error(`Session not found: ${sessionId}`);
  error.code = "CC_REPL_SESSION_NOT_FOUND";
  const candidate = failedReplJsonlResumeCandidate(sessionId, error, null);
  REPL_JSONL_RESUME_ABSENCE_CANDIDATES.add(candidate);
  return candidate;
}

/**
 * Prepare a JSONL resume transaction from exactly one fully verified sample.
 * Messages, the public snapshot, and MCP recovery authority are derived by the
 * shared reader from that same event array. A present-but-invalid transcript is
 * an inert structured refusal and cannot be committed into the active REPL.
 */
export function prepareReplJsonlResumeCandidate(sessionId, dependencies = {}) {
  let sessionSnapshot = null;
  try {
    validateReplResumeSessionId(sessionId);
    const readResumeState = dependencyDataFunction(
      dependencies,
      "readSessionHostResumeState",
      readSessionHostResumeState,
    );
    const formatNotice = dependencyDataFunction(
      dependencies,
      "formatMcpLedgerRecoveryNotice",
      formatMcpLedgerRecoveryNotice,
    );
    const state = synchronousReplRecoveryValue(
      readResumeState(sessionId),
      "REPL session host resume state",
    );
    if (state === null) return absentReplJsonlResumeCandidate(sessionId);
    const stateDescriptors = plainDataDescriptors(
      state,
      "REPL session host resume state",
    );
    sessionSnapshot = snapshotReplMessageValue(
      dataDescriptorValue(
        stateDescriptors,
        "snapshot",
        "REPL session host resume state",
      ),
      "REPL session host snapshot",
    );
    if (
      !isVerifiedSessionHostSnapshot(sessionSnapshot) ||
      sessionSnapshot.sessionId !== sessionId
    ) {
      const error = new Error(
        "Canonical JSONL session is not fully verified; resume was refused",
      );
      error.code = "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED";
      throw error;
    }
    const rawRebuiltMessages = snapshotReplMessages(
      dataDescriptorValue(
        stateDescriptors,
        "messages",
        "REPL session host resume state",
      ),
    );
    // The injected host seam may supply plain persisted fields. Only the
    // runtime-only provenance already established by the verified store is
    // canonical; unmarked host prompts and forged wire tags are removed before
    // REPL normalization or any side effect.
    const rebuiltMessages = snapshotReplMessages(
      projectCanonicalResumeMessages(rawRebuiltMessages),
    );
    const normalizedReplay = normalizeReplReplayMessages(rebuiltMessages);
    const mcp = createReplMcpRecoveryCandidate(
      sessionId,
      dataDescriptorValue(
        stateDescriptors,
        "recovery",
        "REPL session host resume state",
      ),
      formatNotice,
    );
    if (
      mcp.recoveryError ||
      mcp.recovery.headHash !== sessionSnapshot.head.hash ||
      mcp.recovery.recoveryDigest !==
        sessionSnapshot.recoveryAuthority.recoveryDigest
    ) {
      const error = new Error(
        "Canonical JSONL messages and MCP recovery authority do not share one head",
      );
      error.code = "CC_REPL_SESSION_AUTHORITY_MISMATCH";
      throw error;
    }
    return brandedFrozenCandidate(REPL_JSONL_RESUME_CANDIDATES, {
      ok: true,
      sessionId,
      rebuiltMessages,
      replayMessages: normalizedReplay.replayMessages,
      canonicalSystemMessages: normalizedReplay.canonicalSystemMessages,
      conversationMessages: normalizedReplay.conversationMessages,
      sessionSnapshot,
      mcp,
      error: null,
    });
  } catch (error) {
    return failedReplJsonlResumeCandidate(sessionId, error, sessionSnapshot);
  }
}

/**
 * Resolve startup storage only after a requested canonical JSONL session has
 * been sampled and verified. A present canonical session is authoritative;
 * feature/config reads are reserved for new sessions or the legacy DB
 * fallback when no JSONL transcript exists.
 */
export function prepareReplStartupResume(sessionId, dependencies = {}) {
  if (sessionId !== null && sessionId !== undefined) {
    const candidate = prepareReplJsonlResumeCandidate(sessionId, dependencies);
    if (candidate.ok) {
      return Object.freeze({ useJsonl: true, candidate });
    }
    if (!REPL_JSONL_RESUME_ABSENCE_CANDIDATES.has(candidate)) {
      return Object.freeze({ useJsonl: true, candidate });
    }
  }

  const readFeature = dependencyDataFunction(dependencies, "feature", feature);
  return Object.freeze({
    useJsonl: Boolean(readFeature("JSONL_SESSION")),
    candidate: null,
  });
}

function assertReplStartupAdmission(value) {
  synchronousReplRecoveryValue(value, "REPL startup admission");
  const descriptors = plainDataDescriptors(value, "REPL startup admission");
  const useJsonl = dataDescriptorValue(
    descriptors,
    "useJsonl",
    "REPL startup admission",
  );
  const candidate = dataDescriptorValue(
    descriptors,
    "candidate",
    "REPL startup admission",
  );
  if (
    typeof useJsonl !== "boolean" ||
    !Object.isFrozen(value) ||
    (candidate !== null &&
      (!REPL_JSONL_RESUME_CANDIDATES.has(candidate) ||
        !Object.isFrozen(candidate))) ||
    (candidate !== null && useJsonl !== true)
  ) {
    throw invalidReplRecovery(
      "REPL startup admission capability is invalid",
      "CC_REPL_STARTUP_ADMISSION_INVALID",
    );
  }
  return value;
}

function refuseReplStartupResume(options, candidate) {
  const observedCode = safeRecoveryErrorValue(
    candidate?.error,
    "code",
    "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
  );
  const refusal = Object.freeze({
    started: false,
    exitCode: 1,
    code:
      typeof observedCode === "string" && observedCode
        ? observedCode
        : "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
    sessionId: options.sessionId,
    sessionSnapshot: candidate?.sessionSnapshot || null,
  });
  logger.error(
    JSON.stringify({
      type: "session.resume.refused",
      ...refusal,
    }),
  );
  process.exitCode = 1;
  return refusal;
}

function commitPreparedReplResume(prepared, commit, rollback) {
  if (!prepared || typeof commit !== "function") return false;
  try {
    commit(prepared);
    return true;
  } catch (commitError) {
    if (typeof rollback === "function") {
      try {
        rollback(prepared, commitError);
      } catch (rollbackError) {
        const error = new AggregateError(
          [commitError, rollbackError],
          "REPL session resume and rollback both failed",
        );
        error.code = "CC_REPL_SESSION_RESUME_ROLLBACK_FAILED";
        throw error;
      }
    }
    throw commitError;
  }
}

/** Commit a fully prepared JSONL switch; forged/failed candidates are inert. */
export function commitPreparedReplJsonlResume(candidate, commit, rollback) {
  if (
    !candidate ||
    !REPL_JSONL_RESUME_CANDIDATES.has(candidate) ||
    !candidate.ok
  ) {
    return false;
  }
  return commitPreparedReplResume(candidate, commit, rollback);
}

/** Commit the already parsed and snapshotted legacy-DB resume state. */
export function commitPreparedReplDbResume(preparedState, commit, rollback) {
  return commitPreparedReplResume(preparedState, commit, rollback);
}

/**
 * Own the exact mutable state switched by the interactive `/session resume`
 * command. Both JSONL and legacy-DB paths use this controller, which also gives
 * tests a behavioral seam for failures at each real apply stage.
 */
export function createReplResumeStateController(bindings) {
  const snapshots = new WeakSet();
  const hostSystemMessagePrefixes = new WeakSet();
  let registeredHostSystemMessages = null;
  const replaceArray = (target, values) => {
    target.length = 0;
    for (const value of values) target.push(value);
  };
  const invalidHostPrefix = (message) =>
    invalidReplRecovery(message, "CC_REPL_HOST_SYSTEM_PREFIX_INVALID");
  const assertHostSystemMessages = (candidate) => {
    if (
      !candidate ||
      !hostSystemMessagePrefixes.has(candidate) ||
      !Array.isArray(candidate) ||
      !Object.isFrozen(candidate) ||
      candidate.length === 0 ||
      candidate.some(
        (message) =>
          !message || message.role !== "system" || !Object.isFrozen(message),
      )
    ) {
      throw invalidHostPrefix("REPL host system prefix capability is invalid");
    }
    return candidate;
  };
  const createHostSystemMessages = (sourceMessages) => {
    const snapshot = snapshotReplMessages(sourceMessages);
    const leadingSystems = [];
    for (const message of snapshot) {
      if (message.role !== "system") break;
      leadingSystems.push(message);
    }
    if (leadingSystems.length === 0) {
      throw invalidHostPrefix("REPL host system prefix is empty");
    }
    const capability = Object.freeze(leadingSystems);
    hostSystemMessagePrefixes.add(capability);
    return capability;
  };
  const registerHostSystemMessages = () => {
    if (registeredHostSystemMessages !== null) {
      throw invalidHostPrefix("REPL host system prefix is already registered");
    }
    registeredHostSystemMessages = createHostSystemMessages(bindings.messages);
    return registeredHostSystemMessages;
  };
  const refreshHostSystemMessages = () => {
    const registered = assertHostSystemMessages(registeredHostSystemMessages);
    const currentBase = snapshotReplMessages([bindings.messages[0]])[0];
    if (currentBase.role !== "system") {
      throw invalidHostPrefix("REPL current host base system is invalid");
    }
    const capability = Object.freeze([currentBase, ...registered.slice(1)]);
    hostSystemMessagePrefixes.add(capability);
    registeredHostSystemMessages = capability;
    return capability;
  };
  const materializeHostSystemMessages = (candidate) =>
    assertHostSystemMessages(candidate).map((message) => ({ ...message }));

  const capture = () => {
    const hostSystemMessages = assertHostSystemMessages(
      registeredHostSystemMessages,
    );
    const mcpRuntime = bindings.runtimeManager.current;
    if (!mcpRuntime) {
      const error = new Error("Active MCP recovery runtime is unavailable");
      error.code = "CC_REPL_MCP_RUNTIME_UNAVAILABLE";
      throw error;
    }
    const snapshot = Object.freeze({
      sessionId: bindings.sessionId,
      messages: Object.freeze(bindings.messages.slice()),
      recovery: bindings.recovery,
      recoveryError: bindings.recoveryError,
      sanitizeRolesNextTurn: bindings.sanitizeRolesNextTurn,
      turnBindingProducer: bindings.turnBindingProducer,
      turnBindingCriticalError: bindings.turnBindingCriticalError,
      checkpointMarks: Object.freeze(bindings.checkpointMarks.slice()),
      clearedConversation: bindings.clearedConversation,
      hostSystemMessages,
      mcpRuntime,
    });
    snapshots.add(snapshot);
    return snapshot;
  };

  const restore = (snapshot) => {
    if (!snapshot || !snapshots.has(snapshot)) {
      throw new TypeError("REPL resume snapshot is invalid");
    }
    bindings.sessionId = snapshot.sessionId;
    replaceArray(bindings.messages, snapshot.messages);
    bindings.recovery = snapshot.recovery;
    bindings.recoveryError = snapshot.recoveryError;
    bindings.sanitizeRolesNextTurn = snapshot.sanitizeRolesNextTurn;
    bindings.turnBindingProducer = snapshot.turnBindingProducer;
    bindings.turnBindingCriticalError = snapshot.turnBindingCriticalError;
    replaceArray(bindings.checkpointMarks, snapshot.checkpointMarks);
    bindings.clearedConversation = snapshot.clearedConversation;
    registeredHostSystemMessages = assertHostSystemMessages(
      snapshot.hostSystemMessages,
    );
    if (bindings.runtimeManager.current !== snapshot.mcpRuntime) {
      bindings.runtimeManager.commit(snapshot.mcpRuntime);
    }
  };

  const apply = (preparedState) => {
    const hostSystemMessages = assertHostSystemMessages(
      preparedState.hostSystemMessages,
    );
    const activeHostSystemMessages =
      materializeHostSystemMessages(hostSystemMessages);
    const canonicalSystemMessages = snapshotReplMessages(
      preparedState.canonicalSystemMessages,
    );
    const conversationMessages = snapshotReplMessages(
      preparedState.conversationMessages,
    );
    if (
      canonicalSystemMessages.some((message) => message.role !== "system") ||
      conversationMessages.some((message) => message.role === "system")
    ) {
      throw invalidHostPrefix(
        "REPL prepared resume message partition is invalid",
      );
    }
    bindings.sessionId = preparedState.sessionId;
    replaceArray(bindings.messages, activeHostSystemMessages);
    registeredHostSystemMessages = hostSystemMessages;
    for (const message of canonicalSystemMessages) {
      bindings.messages.push(message);
    }
    bindings.applyMcpRecoveryCommit(bindings.messages, preparedState.mcpCommit);
    for (const message of conversationMessages) {
      bindings.messages.push(message);
    }
    bindings.sanitizeRolesNextTurn = preparedState.sanitizeRolesNextTurn;
    bindings.turnBindingProducer = null;
    bindings.turnBindingCriticalError = null;
    bindings.checkpointMarks.length = 0;
    bindings.clearedConversation = null;
    bindings.runtimeManager.commit(preparedState.mcpRuntime);
    bindings.logMcpRecoveryCommit(preparedState.mcpCommit);
    bindings.logger.info(preparedState.logMessage);
  };

  return Object.freeze({
    capture,
    restore,
    apply,
    registerHostSystemMessages,
    refreshHostSystemMessages,
  });
}

/**
 * Own the single recovery runtime for the active REPL session/client pair.
 * Session switches are prepared without mutating the active runtime, then
 * committed only after the transcript switch succeeds.
 */
export function createReplMcpHostRuntimeManager(dependencies = {}) {
  const createRuntime =
    dependencies.createMcpHostRecoveryRuntime || createMcpHostRecoveryRuntime;
  const createLedgerSink =
    dependencies.createSessionMcpLedgerSink || createSessionMcpLedgerSink;
  const appendLedgerEvent =
    dependencies.appendAuthorityEvent || appendAuthorityEvent;
  const candidates = new WeakSet();
  let current = null;

  const prepare = ({
    adhocMcp = null,
    bundleMcpClient = null,
    sessionId = null,
    persistent = false,
    recovery = null,
    recoveryError = null,
    verifiedRecovery = false,
    dispatchAdmission = null,
  } = {}) => {
    const bundle = adhocMcp?.mcpClient
      ? adhocMcp
      : bundleMcpClient
        ? { mcpClient: bundleMcpClient }
        : null;
    const rawClient = bundle?.mcpClient || null;
    const persistLedger = Boolean(persistent && sessionId);

    if (
      !verifiedRecovery &&
      current &&
      current.rawClient === rawClient &&
      current.sessionId === sessionId &&
      current.persistent === persistLedger &&
      current.recovery === recovery &&
      current.recoveryError === recoveryError &&
      current.dispatchAdmission === dispatchAdmission
    ) {
      return current;
    }

    const sink = persistLedger
      ? createLedgerSink(
          sessionId,
          appendLedgerEvent === appendAuthorityEvent
            ? { recovery }
            : { appendEvent: appendLedgerEvent },
        )
      : null;
    const sharedController =
      !verifiedRecovery && current?.sessionId === sessionId
        ? current.runtime.controller
        : null;
    const runtime = createRuntime({
      bundle,
      rawClient,
      sessionId,
      sink,
      recovery,
      recoveryError,
      ...(dispatchAdmission ? { dispatchAdmission } : {}),
      ...(sharedController ? { controller: sharedController } : {}),
    });
    const candidate = Object.freeze({
      runtime,
      rawClient,
      hostMcp: bundle
        ? Object.freeze({
            ...bundle,
            mcpClient: runtime.client,
          })
        : null,
      sessionId,
      persistent: persistLedger,
      recovery,
      recoveryError,
      dispatchAdmission,
      verifiedRecovery: Boolean(verifiedRecovery),
    });
    candidates.add(candidate);
    return candidate;
  };

  const commit = (candidate) => {
    if (!candidate || !candidates.has(candidate)) {
      throw new TypeError("MCP host runtime candidate is invalid");
    }
    current = candidate;
    return current;
  };

  return Object.freeze({
    prepare,
    commit,
    activate(options) {
      return commit(prepare(options));
    },
    get current() {
      return current;
    },
  });
}

/**
 * Execute the startup boundary with explicit host-owned dependencies. Exported
 * for behavior tests; callers cannot obtain the private workspace starter, and
 * the public startAgentRepl() below always supplies the real fixed bindings.
 */
export async function runReplStartupBoundary(options, startupDependencies) {
  if (options.observabilityScope != null && options.ephemeral === true) {
    throw Object.assign(
      new Error(
        "observability scope requires durable session persistence and cannot be combined with ephemeral mode",
      ),
      { code: "CC_OBSERVABILITY_SCOPE_EPHEMERAL_CONFLICT" },
    );
  }
  const prepareStartup = dependencyDataFunction(
    startupDependencies,
    "prepareReplStartupResume",
    null,
  );
  if (typeof prepareStartup !== "function") {
    throw invalidReplRecovery(
      "REPL startup admission dependency is missing",
      "CC_REPL_STARTUP_DEPENDENCY_INVALID",
    );
  }
  const startupAdmission = assertReplStartupAdmission(
    synchronousReplRecoveryValue(
      prepareStartup(options.sessionId),
      "REPL startup admission",
    ),
  );
  const startupCandidate = startupAdmission.candidate;
  if (
    options.observabilityScope != null &&
    startupAdmission.useJsonl !== true
  ) {
    throw Object.assign(
      new Error(
        "observability scope requires durable JSONL session persistence, but JSONL storage is unavailable",
      ),
      { code: "CC_OBSERVABILITY_SCOPE_JSONL_REQUIRED" },
    );
  }
  if (options.observabilityScope != null && startupCandidate?.ok === true) {
    throw Object.assign(
      new Error(
        "an existing REPL session scope cannot be overwritten; create a new scoped session",
      ),
      { code: "CC_OBSERVABILITY_SCOPE_IMMUTABLE" },
    );
  }
  if (startupCandidate && !startupCandidate.ok) {
    const refuseStartup = dependencyDataFunction(
      startupDependencies,
      "refuseReplStartupResume",
      null,
    );
    if (typeof refuseStartup !== "function") {
      throw invalidReplRecovery(
        "REPL startup refusal dependency is missing",
        "CC_REPL_STARTUP_DEPENDENCY_INVALID",
      );
    }
    return refuseStartup(options, startupCandidate);
  }
  if (
    options.sessionBudgetRoot?.enabled === true &&
    startupAdmission.useJsonl !== true
  ) {
    throw Object.assign(
      new Error(
        "session budget root requires durable JSONL session persistence, but JSONL storage is unavailable",
      ),
      { code: "CC_SESSION_BUDGET_JSONL_REQUIRED" },
    );
  }

  // Only a frozen, branded admission capability may cross into workspace,
  // pipe, config, plugin, hook, MCP, model, or tool initialization.
  const readCwd = dependencyDataFunction(startupDependencies, "cwd", null);
  const enterWorkspace = dependencyDataFunction(
    startupDependencies,
    "runWithHostHooksV2Workspace",
    null,
  );
  const startWorkspace = dependencyDataFunction(
    startupDependencies,
    "startAgentReplInWorkspace",
    null,
  );
  if (
    typeof readCwd !== "function" ||
    typeof enterWorkspace !== "function" ||
    typeof startWorkspace !== "function"
  ) {
    throw invalidReplRecovery(
      "REPL host startup dependency is missing",
      "CC_REPL_STARTUP_DEPENDENCY_INVALID",
    );
  }
  const acquireHostLease = dependencyDataFunction(
    startupDependencies,
    "acquireSessionHostLease",
    null,
  );
  const leaseScope = options._sessionHostLeaseScope || null;
  const budgetScope = options._sessionBudgetRootScope || null;
  const leaseSessionId = startupCandidate?.sessionId || options.sessionId;
  if (
    leaseScope &&
    !leaseScope.lease &&
    leaseSessionId &&
    typeof acquireHostLease === "function"
  ) {
    leaseScope.lease = acquireHostLease(leaseSessionId, { hostKind: "repl" });
  }
  let workspaceOptions = options;
  if (options.sessionBudgetRoot?.enabled === true) {
    if (!leaseSessionId || !leaseScope?.lease) {
      throw Object.assign(
        new Error(
          "session budget root requires an acquired REPL host lease for its durable session",
        ),
        { code: "CC_SESSION_BUDGET_LEASE_REQUIRED" },
      );
    }
    if (!budgetScope || budgetScope.root) {
      throw Object.assign(
        new Error("REPL session budget root scope is invalid"),
        { code: "CC_SESSION_BUDGET_SCOPE_INVALID" },
      );
    }
    const openBudgetRoot = dependencyDataFunction(
      startupDependencies,
      "openProductionSessionBudgetRoot",
      null,
    );
    if (typeof openBudgetRoot !== "function") {
      throw invalidReplRecovery(
        "REPL session budget root dependency is missing",
        "CC_REPL_STARTUP_DEPENDENCY_INVALID",
      );
    }
    const root = openBudgetRoot(leaseSessionId, options.sessionBudgetRoot, {
      persist: true,
      signal: combineReplSignals(options.signal, leaseScope.lease.signal),
      table: options.sessionBudgetRoot.table,
    });
    if (
      root?.enabled !== true ||
      !root.budget ||
      !root.options ||
      root.options.sessionBudget !== root.budget ||
      typeof root.close !== "function"
    ) {
      try {
        root?.close?.();
      } catch {
        // The invalid root is rejected regardless of cleanup outcome.
      }
      throw Object.assign(new Error("REPL session budget root is invalid"), {
        code: "CC_SESSION_BUDGET_ROOT_INVALID",
      });
    }
    if (root.budget.signal?.aborted === true) {
      const admissionError = sessionBudgetAdmissionError(
        root.budget.reason?.(),
        "REPL startup",
      );
      try {
        await root.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [admissionError, cleanupError],
          "REPL budget admission and authority cleanup both failed",
        );
      }
      throw admissionError;
    }
    budgetScope.root = root;
    workspaceOptions = { ...options, ...root.options };
  }
  const trustedWorkspaceRoot = readCwd();
  return enterWorkspace(trustedWorkspaceRoot, () =>
    startWorkspace(workspaceOptions, startupAdmission),
  );
}

/** Start a REPL JSONL session while preserving legacy best-effort behavior. */
export function startReplJsonlSession(
  startSession,
  requestedId,
  meta,
  observabilityScope,
  options = {},
) {
  const requireDurable =
    observabilityScope != null || options.requireDurable === true;
  try {
    const sessionId = startSession(requestedId, {
      ...meta,
      ...(observabilityScope != null ? { observabilityScope } : {}),
    });
    if (requireDurable && (typeof sessionId !== "string" || !sessionId)) {
      throw new Error("JSONL session creation returned no durable session id");
    }
    return sessionId || null;
  } catch (error) {
    if (!requireDurable) return null;
    const failure = new Error(
      observabilityScope != null
        ? "scoped JSONL session could not be durably created"
        : "budgeted JSONL session could not be durably created",
      { cause: error },
    );
    failure.code =
      observabilityScope != null
        ? "CC_OBSERVABILITY_SCOPE_START_FAILED"
        : "CC_SESSION_BUDGET_SESSION_START_FAILED";
    throw failure;
  }
}

/** Start the agentic REPL with non-overridable production bindings. */
export async function startAgentRepl(options = {}) {
  const sessionHostLeaseScope = { lease: null };
  const sessionBudgetRootScope = { root: null };
  const runtimeOptions = {
    ...options,
    _sessionHostLeaseScope: sessionHostLeaseScope,
    _sessionBudgetRootScope: sessionBudgetRootScope,
  };
  try {
    const result = await runReplStartupBoundary(runtimeOptions, {
      prepareReplStartupResume,
      refuseReplStartupResume,
      acquireSessionHostLease,
      openProductionSessionBudgetRoot,
      cwd: () => process.cwd(),
      runWithHostHooksV2Workspace,
      startAgentReplInWorkspace,
    });
    if (result?.started === false) {
      await closeReplSessionBudgetRootScope(sessionBudgetRootScope);
      releaseReplSessionHostLeaseScope(sessionHostLeaseScope);
    }
    return result;
  } catch (error) {
    const cleanupErrors = [];
    try {
      await closeReplSessionBudgetRootScope(sessionBudgetRootScope);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      releaseReplSessionHostLeaseScope(sessionHostLeaseScope);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "REPL startup and authority cleanup both failed",
      );
    }
    throw error;
  }
}

async function startAgentReplInWorkspace(options = {}, startupAdmission) {
  let failureHandler = null;
  let disposePipeSafety = null;
  const flow = installOutputBackpressure({
    stdout: process.stdout,
    stderr: process.stderr,
    maxQueuedBytes: options.outputBackpressureMaxBytes,
    onFailure: (error) => failureHandler?.(error),
  });
  let restored = false;
  const outputScope = {
    flow,
    setFailureHandler(handler) {
      failureHandler = handler;
    },
    setPipeDisposer(disposer) {
      disposePipeSafety = disposer;
    },
    restore() {
      if (restored) return;
      restored = true;
      disposePipeSafety?.();
      flow.restore();
    },
  };
  try {
    return await startAgentReplInWorkspaceOwned(
      options,
      startupAdmission,
      outputScope,
    );
  } catch (error) {
    outputScope.restore();
    throw error;
  }
}

async function startAgentReplInWorkspaceOwned(
  options = {},
  startupAdmission,
  outputScope,
) {
  // EPIPE guard: if the REPL's stdout is piped and the consumer closes (e.g.
  // `cc agent | head`), the async stream `error` would otherwise crash the
  // process. Route a broken pipe into the REPL's own graceful shutdown (the
  // rl "close" handler — MCP disconnect, kill background tasks) when the
  // interface and its close handler exist. `_replClosing` makes it fire once so
  // a cleanup write that also EPIPEs can't loop. An early EPIPE remains pending
  // until the close handler is attached; it never skips directly to exit.
  let _replRl = null;
  let _replClosing = false;
  let _replCloseReady = false;
  let _replCleanupStarted = false;
  let _turnAbort = null;
  let _replOutputFailure = null;
  const _requestReplOutputClose = (error) => {
    if (error && !_replOutputFailure) _replOutputFailure = error;
    if (error) {
      process.exitCode = error.code === "EPIPE" ? 0 : 1;
      _turnAbort?.abort(error);
    }
    if (_replClosing) return;
    _replClosing = true;
    if (_replRl && _replCloseReady) {
      try {
        _replRl.close(); // triggers the graceful "close" cleanup
      } catch {
        // The close handler owns shutdown. Leaving exitCode set allows the
        // event loop to drain without bypassing the teardown lifecycle.
      }
    }
  };
  const _sessionHostLeaseScope = options._sessionHostLeaseScope || null;
  const _sessionBudgetRootScope = options._sessionBudgetRootScope || null;
  const _sessionBudget = options.sessionBudget || null;
  let _sessionHostLeaseAbortListener = null;
  let _sessionHostLeaseAbortSignal = null;
  const _detachSessionHostLease = () => {
    if (_sessionHostLeaseAbortListener && _sessionHostLeaseAbortSignal) {
      _sessionHostLeaseAbortSignal.removeEventListener(
        "abort",
        _sessionHostLeaseAbortListener,
      );
    }
    _sessionHostLeaseAbortListener = null;
    _sessionHostLeaseAbortSignal = null;
  };
  const _attachSessionHostLease = () => {
    const signal = _sessionHostLeaseScope?.lease?.signal;
    if (!signal || _sessionHostLeaseAbortListener) return;
    _sessionHostLeaseAbortListener = () =>
      _requestReplOutputClose(
        signal.reason ||
          Object.assign(new Error("Session host lease was lost"), {
            code: "CC_SESSION_HOST_LEASE_FENCED",
          }),
      );
    _sessionHostLeaseAbortSignal = signal;
    signal.addEventListener("abort", _sessionHostLeaseAbortListener, {
      once: true,
    });
    if (signal.aborted) _sessionHostLeaseAbortListener();
  };
  const _replaceSessionHostLease = (lease) => {
    if (!_sessionHostLeaseScope) return null;
    const previous = _sessionHostLeaseScope.lease;
    if (previous === lease) return previous;
    _detachSessionHostLease();
    _sessionHostLeaseScope.lease = lease;
    _attachSessionHostLease();
    return previous;
  };
  _attachSessionHostLease();
  let _sessionBudgetAbortListener = null;
  let _sessionBudgetAbortSignal = null;
  const _detachSessionBudget = () => {
    if (_sessionBudgetAbortListener && _sessionBudgetAbortSignal) {
      _sessionBudgetAbortSignal.removeEventListener(
        "abort",
        _sessionBudgetAbortListener,
      );
    }
    _sessionBudgetAbortListener = null;
    _sessionBudgetAbortSignal = null;
  };
  const _attachSessionBudget = () => {
    const signal = _sessionBudget?.signal;
    if (!signal || _sessionBudgetAbortListener) return;
    _sessionBudgetAbortListener = () =>
      _requestReplOutputClose(
        sessionBudgetAdmissionError(
          _sessionBudget.reason?.() || "session-aborted",
          "REPL session",
        ),
      );
    _sessionBudgetAbortSignal = signal;
    signal.addEventListener("abort", _sessionBudgetAbortListener, {
      once: true,
    });
    if (signal.aborted) _sessionBudgetAbortListener();
  };
  _attachSessionBudget();
  const _replOutputFlow = outputScope.flow;
  outputScope.setFailureHandler(_requestReplOutputClose);
  const _disposeReplPipeSafety = installPipeSafety(undefined, () =>
    _requestReplOutputClose(
      Object.assign(new Error("REPL output pipe closed"), { code: "EPIPE" }),
    ),
  );
  outputScope.setPipeDisposer(_disposeReplPipeSafety);
  const _waitForReplOutput = async () => {
    try {
      await _replOutputFlow.wait();
      return true;
    } catch {
      return false;
    }
  };
  const { useJsonl, candidate: _startupJsonlResume } = startupAdmission;
  // A usage-ledger durability failure makes this REPL terminal. Keep the latch
  // above every direct-model surface (Advisor, /btw, /auto, /plan, /goal), and
  // clear steering immediately so queued work cannot start another paid call.
  let _processingLine = false;
  const _pendingLines = [];
  const _runtimeLedgerTerminalLatch = createReplRuntimeLedgerTerminalLatch({
    onTrip: (terminalError) => {
      _pendingLines.length = 0;
      try {
        _turnAbort?.abort(terminalError);
      } catch {
        // An already-settled turn needs no further cancellation.
      }
    },
  });
  const _reportRuntimeLedgerTerminal = ({ concurrent = false } = {}) => {
    const message = REPL_RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE;
    if (concurrent) process.stderr.write(`\n${message}\n`);
    else logger.error(message);
  };
  const _runReplMeteredModelCall = async ({
    call,
    callProvider,
    callModel,
    source = "model",
    includeLedgerMetadata = false,
  }) => {
    _runtimeLedgerTerminalLatch.assertOpen();
    try {
      const durableSessionId = resolveReplMeteredSessionId(useJsonl, sessionId);
      const metered = await runReplMeteredModelCallWithLedger({
        sessionId: durableSessionId,
        persist: durableSessionId
          ? (type, data) => appendEvent(durableSessionId, type, data)
          : null,
        provider: callProvider || provider,
        model: callModel || model,
        source,
        sessionBudget: _sessionBudget,
        call: () => call({ signal: options.signal || null }),
        attachErrorMetadata: includeLedgerMetadata,
      });
      return includeLedgerMetadata ? metered : metered.result;
    } catch (error) {
      const terminalError = _runtimeLedgerTerminalLatch.trip(error);
      if (terminalError) throw terminalError;
      throw error;
    }
  };
  // Direct chat helpers keep their public string-returning API while routing
  // each private provider envelope through the durable per-call REPL meter.
  const _directChatCallWrapper = ({
    call,
    provider: callProvider,
    model: callModel,
  }) =>
    _runReplMeteredModelCall({
      call,
      callProvider,
      callModel,
      source: "model",
    });
  const _runReplDirectTool = async (tool, args) => {
    _runtimeLedgerTerminalLatch.assertOpen();
    try {
      const durableSessionId = resolveReplMeteredSessionId(useJsonl, sessionId);
      return await runReplDirectToolWithLedger({
        sessionId: durableSessionId,
        tool,
        args,
        execute: (name, toolArgs) =>
          executeTool(name, toolArgs, {
            sessionId: durableSessionId,
            sessionBudget: _sessionBudget,
            signal: options.signal || null,
          }),
        now: options.now || Date.now,
        terminalLatch: _runtimeLedgerTerminalLatch,
      });
    } catch (error) {
      const terminalError = _runtimeLedgerTerminalLatch.trip(error);
      if (terminalError) throw terminalError;
      throw error;
    }
  };
  let model = options.model || "qwen2.5:7b";
  let provider = options.provider || "ollama";
  // Extended thinking (Anthropic; opt-in via --think/--ultrathink). Carried from
  // the runtime policy into the agent-loop options below. Mutable so the
  // `/think` · `/ultrathink` slash commands can toggle it mid-session (the
  // per-turn agentLoop call below reads the current value). thinkingBudget
  // (--thinking-budget) is the companion legacy-model budget_tokens override.
  let thinking = options.thinking || null;
  const thinkingBudget = options.thinkingBudget || null;
  // `/note-next` one-shot guidance rides ONLY the next main turn, then is
  // stripped so it never persists or carries forward. `/btw` itself is an
  // immediate independent side question handled below.
  let pendingBtw = [];
  let _btwRestore = null;
  // Provider-neutral, tool-free Advisor/Critic. Initialized lazily after the
  // durable session and resumed transcript are available; null means the
  // optional surface could not be initialized. Default is off via config.
  let _advisorRuntime = null;
  // Current permission mode (strict|trusted|autopilot|auto), mirrored here so
  // Shift+Tab can cycle it and `/permissions <tier>` can set it. Kept in sync
  // with _approvalGate.setSessionPolicy below. "auto" rides the trusted gate
  // tier but additionally activates the autoMode.decisions classifier wrapper
  // (when settings customize it) — gateTierFor() maps mode → real gate tier.
  let _sessionTier = "strict";
  // `/goal <condition>`: an optional SESSION completion condition. When set, the
  // condition is evaluated + reported after each turn (interactive — no auto
  // re-drive; that autonomous loop is headless-only). null = no session goal.
  let _sessionGoal = null;
  const gateTierFor = (mode) =>
    mode === "auto" ? "trusted" : mode === "dontAsk" ? "strict" : mode;
  // dontAsk (headless parity, interactive form): anything that would prompt
  // is denied instead — both confirmers below consult this before prompting.
  const _dontAskActive = () => _sessionTier === "dontAsk";
  // Resolved autoMode.decisions map (loaded once at startup); null until the
  // gate is wired. The wrapper is installed only when settings customize the
  // map, and only bites while _sessionTier === "auto" (isActive predicate).
  let _autoModeResolved = null;
  // `/remote-control` (批17/18 REPL 收口): paired-device approvals for this
  // interactive session. Holds { bridge, pairing, close } while active; both
  // interactive confirmers below race the terminal against the paired device
  // (first answer wins). null = local-only (byte-identical prompt path).
  let _remoteApproval = null;
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || null;
  // Configured vision model (config.llm.visionModel) — used when a turn carries
  // an auto-detected image path so the REPL switches to a vision-capable model
  // for that turn only (resolveVisionLlm falls back to the default when unset).
  let _visionModel;
  let _promptInteractionConfig = {};
  let _persistPromptSuggestionsEnabled = null;
  let _keybindingFlavor = "classic";
  // Hard stream inactivity timeout override (config.llm.streamStallTimeoutMs,
  // ms): a stream silent that long is aborted + retried instead of hanging.
  // Unset → agent-core's 180s default (matches cc chat/ask). Set to 0 to
  // disable. Left undefined here means "use the default".
  let _streamStallTimeoutMs;
  // Auto-pin (default ON since 2026-07-07): compaction pins the original task
  // (first user turn) so it survives context compression. Resolution order:
  // CC_AUTO_PIN env ("1"/"0") > config `context.autoPin` (true/false/object) >
  // default on. See resolveAutoPinOption.
  let _autoPinCfgValue;
  // Idle timeout for interactive permission prompts (0 = wait forever).
  // CC_PERMISSION_ASK_TIMEOUT_MS env > config permissions.askTimeoutMs > off.
  let _askIdleTimeoutMs = resolveAskIdleTimeoutMs();
  try {
    const configManager = await import("../lib/config-manager.js");
    const _cfg = configManager.loadConfig();
    _promptInteractionConfig = _cfg || {};
    _persistPromptSuggestionsEnabled = (enabled) =>
      configManager.setConfigValue("cli.promptSuggestions", enabled === true);
    _visionModel = _cfg?.llm?.visionModel || undefined;
    _autoPinCfgValue = _cfg?.context?.autoPin;
    _askIdleTimeoutMs = resolveAskIdleTimeoutMs({
      config: _cfg?.permissions?.askTimeoutMs,
    });
    const raw = _cfg?.llm?.streamStallTimeoutMs;
    const t = Number(raw);
    // Accept 0 (explicit disable) — only ignore absent/invalid values.
    if (raw != null && Number.isFinite(t) && t >= 0) _streamStallTimeoutMs = t;
  } catch {
    /* optional — resolveVisionLlm falls back to DEFAULT_VISION_MODEL */
  }
  try {
    const { readStringSetting } = await import("../lib/settings-loader.cjs");
    const configuredFlavor = readStringSetting("keybindingFlavor", {
      cwd: process.cwd(),
      settingsFile: options.settingsFile || null,
      managedSettingsFile: options.managedSettingsFile || null,
      onWarn: (message) => logger.warn(message),
    });
    const resolvedFlavor = resolveReplKeybindingFlavor(configuredFlavor);
    _keybindingFlavor = resolvedFlavor.flavor;
    if (resolvedFlavor.error) {
      logger.warn(`settings: ${resolvedFlavor.error}; using classic`);
    }
  } catch (error) {
    if (error?.code === "CC_MANAGED_SETTINGS_INVALID") throw error;
    logger.warn(`settings: could not load keybindingFlavor (${error.message})`);
  }
  // Extra workspace roots (--add-dir): advertised in the system prompt and
  // spanned by search_files.
  const additionalDirectories = Array.isArray(options.additionalDirectories)
    ? options.additionalDirectories
    : [];
  _sandbox = options.sandbox || null;
  // Snapshot the work tree before each mutating tool (git engine) so the user
  // can `cc checkpoint restore` to just before any tool call.
  const autoCheckpoint = options.autoCheckpoint === true;
  const managedCheckpoint = options.managedCheckpoint === true;
  const managedCheckpointStateDir = options.managedCheckpointStateDir || null;
  const managedCheckpointExclusions = Array.isArray(
    options.managedCheckpointExclusions,
  )
    ? options.managedCheckpointExclusions
    : [];

  // --fallback-model: walk an ordered backup-model chain when a turn's LLM
  // call fails (transient error or model-not-found). Built once; passed into
  // every agentLoop call via chatFn. Accepts the resolved chain
  // (options.fallbackModels) or a legacy single model (options.fallbackModel).
  // Undefined when no fallback configured.
  const _fallbackModels = normalizeFallbackModels(
    options.fallbackModels != null
      ? options.fallbackModels
      : options.fallbackModel,
  );
  const _fallbackChatFn = _fallbackModels.length
    ? makeFallbackChatFn({
        fallbackModels: _fallbackModels,
        onFallback: ({ from, to, error, skipped, reason, crossProvider }) =>
          logger.info(
            chalk.yellow(
              skipped
                ? `[fallback] "${to}" skipped (${reason})`
                : `[fallback] model "${from}" failed (${error}); retrying with ${crossProvider ? "cross-provider " : ""}"${to}"`,
            ),
          ),
      })
    : undefined;

  // Bootstrap runtime (best-effort, DB not required)
  let db = null;
  let contextEngine = null;
  let sessionId = _startupJsonlResume?.sessionId || null;
  const _replCompactPersistence = createReplCompactPersistence(
    _startupJsonlResume?.ok ? _startupJsonlResume.rebuiltMessages : [],
  );
  let _compactionUsageBlock = null;

  try {
    const ctx = await bootstrap({ verbose: false });
    db = ctx.db || null;
  } catch (_err) {
    // Continue without DB — static prompt fallback
  }

  // Initialize prompt compressor (adaptive to model's context window)
  if (feature("PROMPT_COMPRESSOR")) {
    _compressor = new PromptCompressor({
      model,
      provider,
      llmQuery: async (prompt) => {
        const {
          result: response,
          callId,
          usageLedgerSettled,
        } = await _runReplMeteredModelCall({
          callProvider: provider,
          callModel: model,
          source: "semantic-compaction",
          includeLedgerMetadata: true,
          call: ({ signal }) =>
            chatWithTools([{ role: "user", content: prompt }], {
              provider,
              model,
              baseUrl,
              apiKey,
              signal,
              enabledToolNames: [],
              extraToolDefinitions: [],
              hostManagedToolPolicy: null,
              contextEngine: null,
              maxOutputTokens: 2048,
            }),
        });
        return {
          summary: response?.message?.content || "",
          usage: response?.usage || null,
          provider,
          model,
          ...(callId ? { callId } : {}),
          ...(usageLedgerSettled ? { usageLedgerSettled: true } : {}),
        };
      },
    });
  }
  const _autoPinOpt = resolveAutoPinOption({ config: _autoPinCfgValue });
  // Compaction options shared by /compact + auto-compact. Adds the
  // pin predicate only when auto-pin is enabled; otherwise byte-identical.
  const _compactOpts = (msgs) => {
    const base = { preserveToolPairs: true };
    if (!_autoPinOpt) return base;
    const isPinned = buildAutoPinPredicate(msgs, _autoPinOpt);
    return isPinned ? { ...base, isPinned } : base;
  };

  // Initialize permanent memory
  let permanentMemory = null;
  try {
    const dataDir = process.env.CHAINLESSCHAIN_DATA_DIR || process.cwd();
    const memoryDir = path.join(dataDir, "memory");
    permanentMemory = new CLIPermanentMemory({ db, memoryDir });
    permanentMemory.initialize();
  } catch (_err) {
    // Non-critical
  }

  contextEngine = new CLIContextEngineering({ db, permanentMemory });

  // Initialize autonomous agent
  const autonomousAgent = new CLIAutonomousAgent();

  // Set hook DB reference for tool pipeline
  _hookDb = db;

  // Live token streaming (Claude-Code parity): stream the answer (and reasoning)
  // token-by-token as the LLM produces it, instead of replaying the finished
  // text with a typewriter. ONLY safe when no AssistantResponse hook is
  // registered — such a hook can rewrite/suppress the final answer, which is
  // impossible once it's already on screen. CC_REPL_STREAM=0 forces the replay.
  let _arHookCount = 0;
  if (_hookDb) {
    try {
      const { listHooks } = await import("../lib/hook-manager.js");
      _arHookCount = (
        listHooks(_hookDb, {
          event: "AssistantResponse",
          enabledOnly: true,
        }) || []
      ).length;
    } catch {
      _arHookCount = -1; // unknown → shouldStreamLive treats as unsafe
    }
  }
  const _streamLive = shouldStreamLive({
    streamEnv: process.env.CC_REPL_STREAM,
    arHookCount: _arHookCount,
  });

  // Wire the persistent ApprovalGate singleton (approval-policies.json) with
  // a readline confirm prompt. agent-core's run_shell branch gates
  // MEDIUM/HIGH-risk commands against the session's policy tier
  // (strict / trusted / autopilot).
  try {
    const { getApprovalGate } =
      await import("../lib/session-core-singletons.js");
    _approvalGate = await getApprovalGate();
    _approvalGate =
      _approvalGate?.createSessionScope?.(
        sessionId || `repl-scope:${randomUUID()}`,
      ) || _approvalGate;
    _approvalGate?.setAuthorizationConsumer?.(null);
    // autoMode.decisions: wrap the gate with the configurable classifier
    // BEFORE setConfirmer so the wrapper captures the interactive confirmer.
    // Inactive (delegating) unless the session mode is "auto"; not installed
    // at all when settings don't customize the map (byte-identical path).
    try {
      const {
        loadAutoModeConfig,
        resolveAutoModeDecisions,
        createAutoModeApprovalGate,
      } = await import("../lib/auto-mode-config.js");
      _autoModeResolved = resolveAutoModeDecisions(
        loadAutoModeConfig({ cwd: process.cwd() }).effective,
      );
      if (_autoModeResolved.customized) {
        _approvalGate = createAutoModeApprovalGate(
          _approvalGate,
          _autoModeResolved,
          { isActive: () => _sessionTier === "auto" },
        );
      }
    } catch (_err) {
      _autoModeResolved = null; // fail to the plain gate tiers
    }
    if (typeof _approvalGate.setConfirmer === "function") {
      // The local prompt as a cancelable handle so an active /remote-control
      // can race it against a paired device: cancel closes the readline when
      // the device answers first, and `canceled` mutes the stranded
      // idle-timeout leg so it can't print "auto-denied" after the fact.
      const askGateApprovalLocally = ({ tool, args, riskLevel }) => {
        const rlConfirm = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        let canceled = false;
        const q = (p) => new Promise((res) => rlConfirm.question(p, res));
        const cmd = args?.command ? ` ${args.command}` : "";
        const promise = (async () => {
          const res = await questionWithIdleTimeout(
            q,
            chalk.yellow(
              `\n[ApprovalGate] ${riskLevel || "medium"} risk command:${cmd}\n` +
                `  Proceed? [y]es once / [a]lways allow / [N]o: `,
            ),
            _askIdleTimeoutMs,
          );
          rlConfirm.close();
          if (canceled) return false; // raced out — the device already decided
          if (res.timedOut) {
            process.stdout.write(
              chalk.yellow(
                `\n  ⏱ no response in ${_askIdleTimeoutMs}ms — auto-denied\n`,
              ),
            );
            return false;
          }
          const ans = res.answer.trim().toLowerCase();
          if (ans === "a" || ans === "always") {
            const saved = await _persistAlwaysAllow(tool || "run_shell", args);
            if (saved) {
              process.stdout.write(
                chalk.green(
                  `  ✓ always allow: added ${saved.rule} → ${saved.file}\n`,
                ),
              );
            }
            return true;
          }
          return ans === "y" || ans === "yes";
        })();
        return {
          promise,
          cancel: () => {
            canceled = true;
            rlConfirm.close();
          },
        };
      };
      _approvalGate.setConfirmer(
        async ({
          tool,
          args,
          riskLevel,
          action,
          cwd,
          workspace,
          sessionId,
          session,
          targetEnv,
          policyVersion,
        }) => {
          if (_dontAskActive()) {
            process.stdout.write(
              chalk.yellow(
                `\n  ✕ denied without asking (dontAsk mode): ${riskLevel || "medium"}-risk ${tool || "run_shell"}${args?.command ? " — " + args.command : ""}\n`,
              ),
            );
            return false;
          }
          await _fireNotification(
            `Permission needed: ${riskLevel || "medium"}-risk ${tool || "run_shell"}${args?.command ? " — " + args.command : ""}`,
            "info",
            _sessionHandle,
          );
          const local = askGateApprovalLocally({ tool, args, riskLevel });
          if (!_remoteApproval?.bridge) return local.promise;
          return raceLocalAndRemote({
            bridge: _remoteApproval.bridge,
            ask: describeAskContext({
              tool,
              args,
              riskLevel,
              action,
              cwd,
              workspace,
              sessionId,
              session,
              targetEnv,
              policyVersion,
            }),
            local,
            writeOut: (text) => process.stdout.write(chalk.cyan(text)),
          });
        },
      );
    }
  } catch (_err) {
    _approvalGate = null;
  }

  // Load .claude/settings.json permission rules + wire an interactive confirmer
  // so `ask` rules prompt (rather than fall closed like headless does).
  try {
    const { readBooleanSetting } = await import("../lib/settings-loader.cjs");
    const { createPermissionRulesProvider, loadPermissionAuthority } =
      await import("../lib/permission-authority.js");
    const permissionAuthorityOptions = { cwd: process.cwd() };
    const loaded = loadPermissionAuthority(permissionAuthorityOptions);
    _permissionRulesProvider = createPermissionRulesProvider(
      permissionAuthorityOptions,
    );
    _managedPermissionRulesOnly =
      loaded.managed?.allowManagedPermissionRulesOnly === true;
    // Claude-Code 2.1.186 respondToBashCommands (default OFF / opt-in when unset).
    _respondToBash = readBooleanSetting("respondToBashCommands", {
      cwd: process.cwd(),
    });
    // Claude-Code 2.1.193 autoMode.classifyAllShell (default OFF when unset).
    _classifyAllShell =
      readBooleanSetting("autoMode.classifyAllShell", {
        cwd: process.cwd(),
      }) === true;
    const total =
      loaded.rules.allow.length +
      loaded.rules.ask.length +
      loaded.rules.deny.length;
    _permissionRules = total > 0 ? loaded.rules : null;
    // Local prompt as a cancelable handle (same shape as the gate confirmer
    // above) so /remote-control can race it against a paired device.
    const askPermissionLocally = ({ tool, args, rule, reason }) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      let canceled = false;
      const q = (p) => new Promise((res) => rl.question(p, res));
      // Picks the right phrasing whether the caller passed a `rule`
      // (settings/hook ask) or a `reason` (destructive-git / sensitive-file
      // guards) — avoids the literal "null" the old template printed.
      const header = buildPermissionPrompt({ tool, args, rule, reason });
      const promise = (async () => {
        const res = await questionWithIdleTimeout(
          q,
          chalk.yellow(`\n${header}\n  Proceed? (y/N) `),
          _askIdleTimeoutMs,
        );
        rl.close();
        if (canceled) return false; // raced out — the device already decided
        if (res.timedOut) {
          process.stdout.write(
            chalk.yellow(
              `\n  ⏱ no response in ${_askIdleTimeoutMs}ms — auto-denied\n`,
            ),
          );
          return false;
        }
        const ans = res.answer.trim().toLowerCase();
        return ans === "y" || ans === "yes";
      })();
      return {
        promise,
        cancel: () => {
          canceled = true;
          rl.close();
        },
      };
    };
    // Confirmer is shared by permission `ask` rules AND hook `ask` decisions,
    // so define it unconditionally (a `hook:` rule label flows through too).
    _permissionConfirm = async ({ tool, args, rule, reason }) => {
      if (_dontAskActive()) {
        process.stdout.write(
          chalk.yellow(
            `\n  ✕ denied without asking (dontAsk mode): ${tool}${rule ? ` (${rule})` : reason ? ` — ${reason}` : ""}\n`,
          ),
        );
        return false;
      }
      await _fireNotification(
        `Permission needed: ${tool}${rule ? " (" + rule + ")" : ""}`,
        "info",
        _sessionHandle,
      );
      const local = askPermissionLocally({ tool, args, rule, reason });
      // This confirmer is consumed as a legacy boolean by settings/hook
      // admission. A remote lease must never be flattened there and then skip
      // the ApprovalGate consume, so this path remains local-only until it can
      // carry the opaque authorization through its own dispatch boundary.
      return local.promise;
    };
  } catch (_err) {
    if (
      _err?.code === "CC_MANAGED_SETTINGS_INVALID" ||
      _err?.code === "CONFIG_HOME_UNSAFE" ||
      String(_err?.code || "").startsWith("CC_SCOPED_PERMISSION_") ||
      String(_err?.code || "").startsWith("DURABLE_SECURITY_STORE_")
    ) {
      throw _err;
    }
    _permissionRules = null;
    _permissionRulesProvider = null;
    _permissionConfirm = null;
    _managedPermissionRulesOnly = false;
  }

  // Load .claude/settings.json `hooks` block (decision-capable PreToolUse/
  // PostToolUse). The interactive _permissionConfirm above doubles as the
  // confirmer for a hook `ask` decision.
  try {
    const { loadHooks, projectHookTrustNotice, attachAuthorityErrors } =
      await import("../lib/settings-hooks.cjs");
    const loaded = loadHooks({ cwd: process.cwd() });
    // Fold in installed plugins' hooks/hooks.json (Phase 3.3c).
    const { mergePluginHooks } = await import("../lib/plugin-runtime/hooks.js");
    const effectiveHooks = mergePluginHooks(
      attachAuthorityErrors(loaded.hooks, loaded.authorityErrors),
      { cwd: process.cwd() },
    );
    _settingsHooks =
      Object.keys(effectiveHooks).length > 0 ||
      effectiveHooks._authorityErrors.length > 0
        ? effectiveHooks
        : null;
    // First-run trust notice for an untrusted/cloned repo's shell-running
    // hooks (Claude-Code 2.1.195 parity). Best-effort, stderr-only.
    try {
      const notice = projectHookTrustNotice({ cwd: process.cwd() });
      if (notice) process.stderr.write(notice + "\n");
    } catch {
      /* trust notice is best-effort */
    }
  } catch (_err) {
    _settingsHooks = {};
    Object.defineProperty(_settingsHooks, "_authorityErrors", {
      value: Object.freeze([
        Object.freeze({
          sourceFile: null,
          code: _err?.code || "CC_HOOK_AUTHORITY_LOAD_FAILED",
        }),
      ]),
      enumerable: false,
    });
  }

  // Start installed plugins' background monitors (Phase 3.3i). Trust-gated
  // inside collectPluginMonitors — only user/local-scope and explicitly-trusted
  // project plugins get a process spawned. Reaped in the SessionEnd cleanup +
  // a process-exit backstop, so no monitor outlives the session.
  try {
    const { collectPluginMonitors } =
      await import("../lib/plugin-runtime/monitors.js");
    const monitors = collectPluginMonitors({ cwd: process.cwd() });
    if (monitors.length > 0) {
      const { PluginMonitorSupervisor } =
        await import("../lib/plugin-monitor-supervisor.js");
      _pluginMonitors = new PluginMonitorSupervisor();
      const started = _pluginMonitors.start(monitors);
      if (started.length > 0) {
        process.stderr.write(
          `  monitors: started ${started.length} from trusted plugin(s): ${started.join(", ")}\n`,
        );
      }
    }
  } catch (_err) {
    _pluginMonitors = null;
  }

  // Preserve PATH compatibility for trusted legacy bin components without a
  // sandboxPolicy, restored at SessionEnd. Policy-bearing bins stay off PATH
  // and use agent-core's exact direct Broker route.
  try {
    const { applyPluginBinPath } = await import("../lib/plugin-runtime/bin.js");
    const res = applyPluginBinPath({ cwd: process.cwd() });
    _pluginBinRestore = res.restore;
    if (res.added.length > 0) {
      process.stderr.write(
        `  bin: added ${res.added.length} plugin bin dir(s) to PATH\n`,
      );
    }
  } catch (_err) {
    _pluginBinRestore = null;
  }

  // Apply trusted plugins' default env vars (Phase 3.3o) — only for env keys the
  // user/system didn't already set; restored at SessionEnd.
  try {
    const { applyPluginSettingsEnv } =
      await import("../lib/plugin-runtime/settings.js");
    const res = applyPluginSettingsEnv({ cwd: process.cwd() });
    _pluginSettingsRestore = res.restore;
    if (res.added.length > 0) {
      process.stderr.write(
        `  settings: applied ${res.added.length} plugin env default(s)\n`,
      );
    }
  } catch (_err) {
    _pluginSettingsRestore = null;
  }

  // Resume existing session or create new one. JSONL resumes were admitted
  // before bootstrap/config/plugin/hook initialization and use that exact
  // verified sample below; do not re-read the transcript here.
  if (!useJsonl && db && options.sessionId) {
    try {
      const existing = getSession(db, options.sessionId);
      if (existing && existing.messages) {
        sessionId = existing.id;
      }
    } catch (_err) {
      // Non-critical — will create new session
    }
  }

  if (!sessionId) {
    const meta = {
      title: `Agent ${new Date().toISOString().slice(0, 10)}`,
      provider,
      model,
      executionLocation: captureAmbientExecutionLocation({ provider, model }),
    };
    if (useJsonl) {
      sessionId = startReplJsonlSession(
        jsonlStartSession,
        options.sessionId || null,
        meta,
        options.observabilityScope,
        { requireDurable: Boolean(_sessionBudget) },
      );
      if (
        sessionId &&
        _sessionHostLeaseScope &&
        !_sessionHostLeaseScope.lease
      ) {
        _sessionHostLeaseScope.lease = acquireSessionHostLease(sessionId, {
          hostKind: "repl",
        });
        _attachSessionHostLease();
      }
    } else if (db) {
      try {
        const session = createSession(db, meta);
        sessionId = session.id;
      } catch (_err) {
        // Non-critical
      }
    }
  }

  // Phase H — register this session with session-core SessionManager so
  // `cc session lifecycle / park / unpark / end` can see and control it.
  // Resume a previously parked handle if --session points at one; otherwise
  // create a fresh handle keyed by the JSONL sessionId.
  let _sessionMgr = null;
  let _sessionHandle = null;
  try {
    const { getSessionManager } =
      await import("../lib/session-core-singletons.js");
    _sessionMgr = getSessionManager();
    if (sessionId) {
      if (options.sessionId && !_sessionMgr.has(sessionId)) {
        // Try unparking; no-op if nothing parked with that id
        try {
          await _sessionMgr.resume(sessionId);
        } catch (_e) {
          /* non-critical */
        }
      }
      if (!_sessionMgr.has(sessionId)) {
        _sessionHandle = _sessionMgr.create({
          agentId: options.agentId || "cli-agent",
          sessionId,
          metadata: { provider, model },
        });
      } else {
        _sessionHandle = _sessionMgr.get(sessionId);
      }
    }
  } catch (_err) {
    // Non-critical — SessionManager integration must not block startup
  }

  // `/remote-control` start/stop (批17 slash 入口 + 批18 REPL 接线): reuses
  // the headless assembly (self-hosted WS on an OS-assigned port + a
  // RemoteApprovalBridge for this session); the interactive difference is
  // purely how the confirmers consume it — they RACE the terminal prompt
  // against the paired device instead of gating on the remote alone.
  const _startRemoteApproval = async () => {
    if (
      !_approvalGate ||
      typeof _approvalGate.setConfirmer !== "function" ||
      typeof _approvalGate.setAuthorizationConsumer !== "function" ||
      typeof _approvalGate.consumeAuthorization !== "function"
    ) {
      const error = new Error(
        "installed session-core cannot bind and consume durable remote approval",
      );
      error.code = "CC_REMOTE_APPROVAL_GATE_UNAVAILABLE";
      throw error;
    }
    const { startHeadlessRemoteApproval } =
      await import("../lib/remote-approval-bridge.js");
    const started = await startHeadlessRemoteApproval({
      agentSessionId:
        sessionId || `repl-${process.pid}-${Date.now().toString(36)}`,
      isText: false, // the REPL prints its own pairing lines below
      allowLan: options.remoteControlAllowLan === true,
      env: process.env,
    });
    _remoteApproval = {
      bridge: started.bridge,
      pairing: started.pairing,
      close: started.close,
    };
    _approvalGate.setAuthorizationConsumer(started.consumeAuthorization);
    logger.log(
      chalk.cyan(
        "  remote-control: permission prompts can be answered from a paired device (first answer — terminal or device — wins)",
      ),
    );
    logger.log(`  pairing: ${started.pairing.uri}`);
    try {
      const { renderQrCode } = await import("../lib/remote-control.js");
      const qr = await renderQrCode(started.pairing.uri);
      if (qr) logger.log(qr);
    } catch (_err) {
      // QR is progressive enhancement — the URI line is the contract
    }
  };
  const _stopRemoteApproval = async () => {
    const active = _remoteApproval;
    _remoteApproval = null; // confirmers fall back to local-only immediately
    _approvalGate?.setAuthorizationConsumer?.(null);
    if (active) await active.close().catch(() => undefined);
  };

  // --remote-control also applies to interactive sessions. Headless fails
  // closed when the bridge can't start (approvals would silently fall
  // closed); interactively the terminal still prompts, so a start failure
  // degrades to local-only with a warning instead of aborting the session.
  if (options.remoteControl === true) {
    try {
      await _startRemoteApproval();
    } catch (err) {
      logger.log(
        chalk.yellow(
          `  remote-control unavailable (${err.message}) — approvals stay local-only`,
        ),
      );
    }
  }

  // --system-prompt replaces the built-in prompt; --append-system-prompt
  // extends it (parity with the headless runners). The base is kept so an
  // output-style persona can be swapped in/out at runtime via /output-style.
  // `let` (not const): /add-dir rebuilds this mid-session to re-advertise the
  // updated working roots; output-style swaps also read it live.
  // --no-project-memory (options.projectMemory === false): lean prompt — skip
  // rules.md (in buildSystemPrompt) + the cc.md/CLAUDE.md block (in
  // composeSystemPrompt). Map only an explicit `false` to a suppressing value;
  // anything else (Commander defaults an absent `--no-` flag to `true`) stays
  // `undefined` so the runtime default-on path — and CC_PROJECT_MEMORY=0 — keep
  // their existing behaviour byte-identically.
  const _leanNoProjectMemory = options.projectMemory === false;
  let _loadedReplInstructions = null;
  let _loadedReplPersonaSkills = [];
  let _replSkillCacheLedger = null;
  const _replSkillLoader = options.skillLoader || new CLISkillLoader();
  const _buildReplBaseSystem = () =>
    composeSystemPrompt(
      buildSystemPrompt(process.cwd(), {
        additionalDirectories,
        projectMemory: options.projectMemory,
        sessionId,
        skillLoader: _replSkillLoader,
        onSkillsLoaded: (skills, cacheLedger) => {
          _loadedReplPersonaSkills = Array.isArray(skills) ? skills : [];
          _replSkillCacheLedger = cacheLedger || null;
        },
      }),
      {
        systemPrompt: options.systemPrompt,
        appendSystemPrompt: options.appendSystemPrompt,
        projectMemory: _leanNoProjectMemory ? false : undefined,
        onInstructionsLoaded: (loaded) => {
          _loadedReplInstructions = loaded;
        },
      },
    );
  let _replBaseSystem = _buildReplBaseSystem();
  let _activeOutputStyle = null; // { name, body }
  const messages = [{ role: "system", content: _replBaseSystem }];
  let _replSideEffects = null;
  const _prepareReplSideEffects = (
    targetSessionId,
    { recover = false } = {},
  ) => {
    if (!useJsonl || !targetSessionId) {
      return Object.freeze({
        sideEffects: null,
        noticeMessage: null,
        warning: null,
      });
    }
    let ledger;
    let loadError = null;
    try {
      ledger = loadSideEffectLedger(targetSessionId);
    } catch (error) {
      ledger = new SideEffectLedger();
      loadError = error;
    }
    const runNonce = `${Date.now()}:${randomUUID()}`;
    let sequence = 0;
    let noticeMessage = null;
    let warning = null;
    if (recover && !loadError) {
      const plan = reconcileSideEffects(ledger);
      if (plan.inspect.length > 0) {
        const lines = plan.plans
          .filter((entry) => entry.action === "inspect")
          .map((entry) => {
            const operation = ledger.get(entry.opId);
            const key = operation?.key ? ` (${operation.key})` : "";
            return `  - [${operation?.kind || "unknown"}]${key} - ${entry.reason}`;
          });
        noticeMessage = Object.freeze({
          role: "system",
          content:
            "Recovery notice: the previous REPL host stopped while irreversible operations were in flight. Their outcome is UNKNOWN. Do not blindly repeat them; verify whether each operation already took effect and ask the user when uncertain:\n" +
            lines.join("\n"),
        });
        warning = `Recovery: ${plan.inspect.length} interrupted non-MCP side effect(s) require verification before replay.`;
      }
    } else if (recover && loadError) {
      noticeMessage = Object.freeze({
        role: "system",
        content:
          "Recovery notice: the durable non-MCP side-effect ledger is unavailable. Read-only work may continue, but irreversible tools are blocked until recovery authority is restored.",
      });
      warning = `Recovery: non-MCP side-effect ledger is unavailable for ${targetSessionId}; irreversible tools are fail-closed.`;
    }
    const sideEffects = Object.freeze({
      ledger,
      nextOpId: () => `${runNonce}:${sequence++}`,
      persist: () => {
        if (loadError) throw loadError;
        const persisted = persistSideEffectLedger(targetSessionId, ledger);
        if (persisted === false) {
          const error = new Error(
            `Side-effect ledger persistence was rejected for ${targetSessionId}`,
          );
          error.code = "SIDE_EFFECT_LEDGER_PERSIST_FAILED";
          throw error;
        }
        return persisted;
      },
      assert: () => _sessionHostLeaseScope?.lease?.assert?.(),
    });
    return Object.freeze({ sideEffects, noticeMessage, warning });
  };
  const _startupReplSideEffects = _prepareReplSideEffects(sessionId, {
    recover: Boolean(options.sessionId && _startupJsonlResume?.ok),
  });
  _replSideEffects = _startupReplSideEffects.sideEffects;
  let _mcpLedgerRecovery = null;
  let _mcpLedgerRecoveryError = null;
  const _prepareJsonlResumeCandidate = (targetSessionId) =>
    prepareReplJsonlResumeCandidate(targetSessionId);
  const _prepareMcpRecoveryCommit = (candidate) => {
    const authorized =
      candidate && REPL_MCP_RECOVERY_CANDIDATES.has(candidate)
        ? candidate
        : failClosedReplMcpRecoveryCandidate(
            sessionId,
            invalidReplRecovery(
              "MCP recovery candidate capability is invalid",
              "CC_REPL_MCP_RECOVERY_CANDIDATE_INVALID",
            ),
            "CC_REPL_MCP_RECOVERY_CANDIDATE_INVALID",
          );
    const recovery = authorized.recovery;
    const recoveryError = authorized.recoveryError;
    const noticeMessage = authorized.notice
      ? Object.freeze({ role: "system", content: authorized.notice })
      : null;
    const warning = recoveryError
      ? "⚠ MCP ledger recovery failed closed; inspect the transcript before using MCP tools."
      : authorized.notice
        ? `⚠ ${recovery.unsettled.length} interrupted MCP call(s), ${recovery.incidents.length} ledger incident(s), and ${recovery.replayDenied.length} exact replay deny/denies require inspection before replay.`
        : null;
    return Object.freeze({
      recovery,
      recoveryError,
      noticeMessage,
      warning,
    });
  };
  const _applyMcpRecoveryCommit = (targetMessages, preparedCommit) => {
    _mcpLedgerRecovery = preparedCommit.recovery;
    _mcpLedgerRecoveryError = preparedCommit.recoveryError;
    if (preparedCommit.noticeMessage) {
      targetMessages.push(preparedCommit.noticeMessage);
    }
    return Boolean(preparedCommit.noticeMessage);
  };
  const _logMcpRecoveryCommit = (preparedCommit) => {
    if (preparedCommit.warning) logger.warn(preparedCommit.warning);
  };
  const _commitMcpRecoveryCandidate = (targetMessages, candidate) => {
    const preparedCommit = _prepareMcpRecoveryCommit(candidate);
    const addedNotice = _applyMcpRecoveryCommit(targetMessages, preparedCommit);
    _logMcpRecoveryCommit(preparedCommit);
    return addedNotice;
  };
  // Resume-degenerate role sanitation (Claude Code 2.1.187 parity): a one-shot
  // flag armed when a resumed transcript ends with a bare `user` turn (the prior
  // run produced no assistant response). Consumed by the first model call so the
  // first live prompt — which would otherwise stack a second `user` and trip
  // "roles must alternate" on Anthropic/Bedrock — is folded exactly once. Gated
  // (not every turn) so the live loop's intentional consecutive-`user` states
  // are never folded.
  let _sanitizeRolesNextTurn = false;
  // Checkpoint marks ({ atMessageCount, id, tool }) recorded as the agent loop
  // emits `checkpoint` events, so `/rewind <n>` can also restore files to the
  // snapshot taken before that turn (Claude-Code rewind = code + conversation).
  const _checkpointMarks = [];
  // Most recent conversation stashed by `/clear`, so `/rewind clear` can bring
  // it back (Claude-Code 2.1.191). Nulled on a context swap so a stash from one
  // session can't be restored into another. { messages, marks } | null.
  let _clearedConversation = null;
  // P1 explicit turn→checkpoint binding — the REPL as PRODUCER (mirrors the
  // headless runner's feed via the shared feeder core): one record per
  // interactive turn, persisted dirty-gated at each settle. Lazily created on
  // the first prompt turn of a persistable (JSONL) session. This is Critical
  // recovery state: a failure blocks subsequent model/tool turns.
  let _turnBindingProducer = null;
  let _turnBindingCriticalError = null;
  // Apply --output-style or the settings.json `outputStyle` default at startup.
  try {
    const { resolveOutputStyle } = await import("../lib/output-styles.js");
    const st = resolveOutputStyle(options.outputStyle, process.cwd());
    if (st && st.body) {
      _activeOutputStyle = { name: st.name, body: st.body };
      messages[0].content = `${_replBaseSystem}\n\n${st.body}`;
    } else if (st && st.name && !st.missing) {
      _activeOutputStyle = { name: st.name, body: "" };
    }
  } catch (_err) {
    // best-effort — no output style
  }

  // settings.json InstructionsLoaded hooks (observe-only): fire once with the
  // exact loaded instruction file set so a hook can audit which cc.md/CLAUDE.md/
  // AGENTS.md/rules are authoritative this session. Best-effort; no-op when
  // project memory is off or no hook is registered.
  if (_settingsHooks && _loadedReplInstructions) {
    try {
      const { runInstructionsLoadedHooks } =
        await import("../lib/settings-hook-events.js");
      const ctx = runInstructionsLoadedHooks(_settingsHooks, {
        files: _loadedReplInstructions.files,
        cwd: process.cwd(),
        sessionId,
      }).additionalContext;
      if (ctx) messages.push({ role: "system", content: ctx });
    } catch (_err) {
      // best-effort
    }
  }

  // settings.json SessionStart hooks → inject session context (observe-only).
  if (_settingsHooks) {
    try {
      const { runSessionStartHooks } =
        await import("../lib/settings-hook-events.js");
      const ctx = runSessionStartHooks(_settingsHooks, {
        source: "startup",
        cwd: process.cwd(),
      }).additionalContext;
      if (ctx) messages.push({ role: "system", content: ctx });
    } catch (_err) {
      // best-effort
    }
  }

  // Deep Agents Deploy Phase 1 — load agent bundle if --bundle provided.
  // Injects AGENTS.md as system prompt, seeds USER.md into MemoryStore,
  // and applies bundle manifest metadata (model/provider override, agentId).
  let _bundleResolved = null;
  let _bundleMcpClient = null;
  // --mcp-config (interactive parity with headless): ad-hoc MCP servers loaded
  // for this session via the shared mcp-config engine. Holds {mcpClient,
  // extraToolDefinitions, externalToolExecutors, externalToolDescriptors}.
  let _adhocMcp = null;
  const _persistReplContextSources = () => {
    if (!useJsonl || !sessionId) return false;
    _replSkillCacheLedger =
      _replSkillLoader.getCacheLedger?.() || _replSkillCacheLedger;
    const mcpDefinitions = _adhocMcp?.extraToolDefinitions || [];
    if (
      mcpDefinitions.length === 0 &&
      _loadedReplPersonaSkills.length === 0 &&
      !_replSkillCacheLedger?.descriptors?.resident
    ) {
      return false;
    }
    try {
      appendEvent(sessionId, "context_sources", {
        mcp: mcpDefinitions.map((definition) => ({
          function: {
            name: definition?.function?.name || null,
            description: definition?.function?.description || "",
            parameters: definition?.function?.parameters || {},
          },
        })),
        skills: _loadedReplPersonaSkills.map((skill) => ({
          id: skill?.id || skill?.displayName || "skill",
          displayName: skill?.displayName || skill?.id || "skill",
          source: skill?.source || "skill",
          tokens: estimateTokens(
            `## Persona: ${skill?.displayName || skill?.id || "skill"}\n${
              typeof skill?.body === "string" ? skill.body : ""
            }`,
          ),
          bodyLoaded: skill?.bodyLoaded === true,
        })),
        skillCache: _replSkillCacheLedger,
      });
      return true;
    } catch {
      // Source attribution must never make an interactive turn fail.
      return false;
    }
  };
  if (options.bundlePath) {
    try {
      const { loadBundle } =
        await import("@chainlesschain/session-core/agent-bundle-loader");
      const { resolveBundle } =
        await import("@chainlesschain/session-core/agent-bundle-resolver");
      const { getMemoryStore } =
        await import("../lib/session-core-singletons.js");
      const bundle = loadBundle(options.bundlePath);

      const memoryStore = getMemoryStore();
      _bundleResolved = resolveBundle(bundle, {
        memoryStore,
        seedOptions: {
          userId: options.agentId || null,
        },
      });

      if (_bundleResolved.systemPrompt) {
        messages.push({
          role: "system",
          content: _bundleResolved.systemPrompt,
        });
      }

      if (_bundleResolved.manifest) {
        if (_bundleResolved.manifest.model && !options.model) {
          model = _bundleResolved.manifest.model;
        }
        if (_bundleResolved.manifest.provider && !options.provider) {
          provider = _bundleResolved.manifest.provider;
        }
      }

      // Connect bundle MCP servers (stdio transport, local mode only).
      const mcpServers = _bundleResolved.mcpConfig?.servers;
      if (mcpServers && typeof mcpServers === "object") {
        const serverEntries = Object.entries(mcpServers).filter(
          ([, cfg]) => cfg && cfg.command,
        );
        if (serverEntries.length > 0) {
          try {
            const { MCPClient } = await import("../harness/mcp-client.js");
            _bundleMcpClient = new MCPClient();
            let connected = 0;
            for (const [name, cfg] of serverEntries) {
              try {
                const authorizedConfig = { ...cfg };
                authorizedConfig.mcpStdioExecutionAuthority =
                  issueMcpStdioExecutionAuthority({
                    serverName: name,
                    config: authorizedConfig,
                    approvalKind: "explicit-config",
                    approvalSource: `agent-bundle:${path.resolve(options.bundlePath)}`,
                  });
                await _bundleMcpClient.connect(name, authorizedConfig);
                connected += 1;
              } catch (mcpErr) {
                logger.log(
                  chalk.yellow(
                    `Bundle MCP: "${name}" connect failed — ${mcpErr.message}`,
                  ),
                );
              }
            }
            if (connected === 0) {
              await _bundleMcpClient.disconnectAll().catch(() => undefined);
              _bundleMcpClient = null;
            }
          } catch (mcpInitErr) {
            logger.log(
              chalk.yellow(`Bundle MCP: init failed — ${mcpInitErr.message}`),
            );
            _bundleMcpClient = null;
          }
        }
      }

      const seedInfo = _bundleResolved.seedResult;
      const seedMsg =
        seedInfo && seedInfo.seeded > 0
          ? `, seeded ${seedInfo.seeded} user memories`
          : "";
      const mcpMsg = _bundleMcpClient
        ? `, ${_bundleMcpClient.servers.size} MCP servers`
        : "";
      const warnMsg =
        _bundleResolved.warnings.length > 0
          ? ` (${_bundleResolved.warnings.length} warnings)`
          : "";
      logger.log(
        chalk.gray(
          `Bundle: loaded ${_bundleResolved.manifest?.id || path.basename(options.bundlePath)}${seedMsg}${mcpMsg}${warnMsg}`,
        ),
      );
    } catch (err) {
      logger.log(chalk.red(`Bundle: failed to load — ${err.message}`));
    }
  }

  // MCP for this interactive session: the ad-hoc --mcp-config file PLUS the
  // servers registered with `cc mcp add --auto-connect`, combined into one
  // client so their tools surface to the LLM as mcp__<server>__<tool>. Reuses
  // the shared engine. Best-effort: a bad --mcp-config is reported but never
  // aborts the REPL; --no-mcp skips the registered set.
  {
    try {
      _adhocMcp = await resolveAgentMcp(
        {
          mcpConfigPath: options.mcpConfig || null,
          db: db?.getDatabase?.() || null,
          includeRegistered: options.useRegisteredMcp !== false,
          // IDE bridge: auto-connect a running editor's MCP server when inside
          // an IDE integrated terminal. --ide forces it, --no-ide disables it
          // (parity with headless; auto-detect already works via process.env).
          ide: options.ide,
          pdh: options.pdh,
          // IDEA built-in MCP (server `idea`): auto-connect when the JetBrains
          // plugin injected CHAINLESSCHAIN_JETBRAINS_MCP_URL. --jetbrains forces,
          // --no-jetbrains disables.
          jetbrains: options.jetbrains,
          cwd: process.cwd(),
          // advertise the session id to spawned stdio MCP servers
          sessionId,
        },
        { writeErr: (s) => process.stderr.write(s) },
      );
      if (_adhocMcp) {
        const toolCount = _adhocMcp.extraToolDefinitions.length;
        logger.log(
          chalk.gray(
            `MCP: ${_adhocMcp.connected.length} server(s), ${toolCount} tool(s) ` +
              `(mcp__<server>__<tool>)`,
          ),
        );
        // MCP tool search (context scaling): defer big tool schemas behind the
        // internal tool_search tool. Below-threshold / disabled → no-op.
        try {
          const { maybeApplyToolSearch } =
            await import("../runtime/mcp-tool-search.js");
          const ts = maybeApplyToolSearch(_adhocMcp, {
            model,
            provider,
            cwd: process.cwd(),
          });
          if (ts) {
            logger.log(
              chalk.gray(
                `MCP: tool search active — ${ts.deferredCount} schema(s) ` +
                  `deferred (~${ts.savedTokens} tok saved)`,
              ),
            );
          }
        } catch (_err) {
          // best-effort — full schemas still work without deferral
        }
      }
    } catch (mcpErr) {
      logger.log(chalk.yellow(`MCP: --mcp-config failed — ${mcpErr.message}`));
      _adhocMcp = null;
    }
  }
  _persistReplContextSources();

  const _mcpHostRuntimeManager = createReplMcpHostRuntimeManager();
  const _mcpDispatchAdmission = (metadata, dispatch) => {
    const lease = _sessionHostLeaseScope?.lease || null;
    if (!lease || typeof lease.admitMcpDispatch !== "function") {
      const error = new Error(
        "REPL session host authority is unavailable for MCP dispatch",
      );
      error.code = "CC_SESSION_HOST_LEASE_FENCED";
      throw error;
    }
    return lease.admitMcpDispatch(metadata, dispatch);
  };
  const _mcpRuntimeInputs = ({
    targetSessionId = sessionId,
    recovery = _mcpLedgerRecovery,
    recoveryError = _mcpLedgerRecoveryError,
  } = {}) => ({
    adhocMcp: _adhocMcp,
    bundleMcpClient: _bundleMcpClient,
    sessionId: targetSessionId,
    persistent: useJsonl && Boolean(targetSessionId),
    recovery,
    recoveryError,
    dispatchAdmission:
      useJsonl && _sessionHostLeaseScope ? _mcpDispatchAdmission : null,
  });
  const _activateMcpHostRuntime = () =>
    _mcpHostRuntimeManager.activate(_mcpRuntimeInputs());
  const _prepareMcpHostRuntime = (targetSessionId, mcpCandidate = {}) =>
    _mcpHostRuntimeManager.prepare({
      ..._mcpRuntimeInputs({
        targetSessionId,
        recovery: mcpCandidate.recovery ?? null,
        recoveryError: mcpCandidate.recoveryError ?? null,
      }),
      verifiedRecovery: true,
    });
  const _getReplHostMcp = () => _activateMcpHostRuntime().hostMcp;
  const _resumeStateController = createReplResumeStateController({
    get sessionId() {
      return sessionId;
    },
    set sessionId(value) {
      sessionId = value;
    },
    messages,
    get recovery() {
      return _mcpLedgerRecovery;
    },
    set recovery(value) {
      _mcpLedgerRecovery = value;
    },
    get recoveryError() {
      return _mcpLedgerRecoveryError;
    },
    set recoveryError(value) {
      _mcpLedgerRecoveryError = value;
    },
    get sanitizeRolesNextTurn() {
      return _sanitizeRolesNextTurn;
    },
    set sanitizeRolesNextTurn(value) {
      _sanitizeRolesNextTurn = value;
    },
    get turnBindingProducer() {
      return _turnBindingProducer;
    },
    set turnBindingProducer(value) {
      _turnBindingProducer = value;
    },
    get turnBindingCriticalError() {
      return _turnBindingCriticalError;
    },
    set turnBindingCriticalError(value) {
      _turnBindingCriticalError = value;
    },
    checkpointMarks: _checkpointMarks,
    get clearedConversation() {
      return _clearedConversation;
    },
    set clearedConversation(value) {
      _clearedConversation = value;
    },
    runtimeManager: _mcpHostRuntimeManager,
    applyMcpRecoveryCommit: _applyMcpRecoveryCommit,
    logMcpRecoveryCommit: _logMcpRecoveryCommit,
    logger,
  });
  const _captureResumeState = _resumeStateController.capture;
  const _restoreResumeState = _resumeStateController.restore;
  const _applyPreparedResumeState = _resumeStateController.apply;
  const _registerHostSystemMessages =
    _resumeStateController.registerHostSystemMessages;
  const _refreshHostSystemMessages =
    _resumeStateController.refreshHostSystemMessages;

  // Seed connected MCP servers with the startup workspace roots when the session
  // began with extra `--add-dir` roots — otherwise `roots/list` would only ever
  // return the cwd until the first mid-session /add-dir. No-op (byte-unchanged)
  // when there are no extra roots. Best-effort.
  if (additionalDirectories.length > 0) {
    try {
      const { workspaceRootDirs, notifyMcpRootsChanged } =
        await import("./add-dir.js");
      notifyMcpRootsChanged(
        [_adhocMcp?.mcpClient, _bundleMcpClient],
        workspaceRootDirs(process.cwd(), additionalDirectories),
      );
    } catch {
      /* best-effort — root advertisement must not block session startup */
    }
  }

  // Apply bundle approval policy to this session (after both gate and sessionId are ready)
  if (_bundleResolved?.approvalPolicy?.default && _approvalGate && sessionId) {
    try {
      _approvalGate.setSessionPolicy(
        sessionId,
        _bundleResolved.approvalPolicy.default,
      );
      // Mirror it so Shift+Tab cycling starts from the real tier.
      const applied = parsePermissionTier(
        _bundleResolved.approvalPolicy.default,
      );
      if (applied) _sessionTier = applied;
    } catch (_err) {
      // Non-critical — invalid policy value is silently ignored
    }
  }

  // --permission-mode for the interactive session (headless parity): manual →
  // strict, acceptEdits → trusted, bypassPermissions → autopilot, and auto →
  // trusted tier + the autoMode.decisions classifier. An explicit flag wins
  // over the bundle's approvalPolicy default. Unknown values are ignored here
  // (headless validates them; interactively we just keep the default tier).
  if (options.permissionMode && _approvalGate && sessionId) {
    const parsed = parsePermissionModeArg(options.permissionMode);
    if (parsed && typeof _approvalGate.setSessionPolicy === "function") {
      try {
        _approvalGate.setSessionPolicy(sessionId, parsed.tier);
        _sessionTier = parsed.auto
          ? "auto"
          : parsed.dontAsk
            ? "dontAsk"
            : parsed.tier;
      } catch (_err) {
        // Non-critical — keep the default tier
      }
    }
  }

  // Phase G #5 — inject top-K memory recall into system prompt for new sessions
  // Skip on resume (existing context already reflects prior work) and when
  // --no-recall-memory is passed.
  if (!options.sessionId && options.recallMemory !== false) {
    try {
      const { buildMemoryInjection } =
        await import("../lib/memory-injection.js");
      const injection = buildMemoryInjection({
        agentId: options.agentId || null,
        query: options.recallQuery || "",
        limit: Number(options.recallLimit) || undefined,
      });
      if (injection) {
        messages.push({ role: injection.role, content: injection.content });
        logger.log(
          chalk.gray(
            `Context: recalled ${injection.count} memory entries into system prompt`,
          ),
        );
      }
    } catch (_err) {
      // Non-critical — memory recall failure must not block REPL startup
    }
  }

  // Seal the complete host-owned leading system prefix exactly once, after
  // startup hooks, bundle context, and optional memory injection, but before
  // any canonical/legacy replay is appended. Later live switches refresh only
  // entry 0 from the active base prompt; they never re-scan old session systems.
  _registerHostSystemMessages();

  let _startupResumeCommitted = false;
  // Load resumed session messages
  if (options.sessionId && sessionId) {
    try {
      if (useJsonl) {
        const prepared = _startupJsonlResume;
        if (!prepared?.ok) {
          const error = new Error(
            "Startup JSONL resume lost its verified admission capability",
          );
          error.code = "CC_REPL_SESSION_RESUME_NOT_PREPARED";
          throw error;
        }
        messages.push(...prepared.canonicalSystemMessages);
        if (_startupReplSideEffects.noticeMessage) {
          messages.push(_startupReplSideEffects.noticeMessage);
        }
        if (_startupReplSideEffects.warning) {
          logger.warn(_startupReplSideEffects.warning);
        }
        _commitMcpRecoveryCandidate(messages, prepared.mcp);
        if (prepared.replayMessages.length > 0) {
          messages.push(...prepared.conversationMessages);
          // Arm the resume role-merge if the prior run left a dangling user turn.
          _sanitizeRolesNextTurn =
            prepared.conversationMessages.at(-1)?.role === "user";
          logger.info(
            `Resumed JSONL session ${sessionId} (${prepared.rebuiltMessages.length} messages)`,
          );
        }
        _startupResumeCommitted = true;
      } else if (db) {
        const existing = getSession(db, sessionId);
        if (existing && existing.messages) {
          const parsed =
            typeof existing.messages === "string"
              ? JSON.parse(existing.messages)
              : existing.messages;
          messages.push(...parsed.filter((m) => m.role !== "system"));
          _sanitizeRolesNextTurn =
            messages[messages.length - 1]?.role === "user";
          logger.info(
            `Resumed session ${sessionId} (${parsed.length} messages)`,
          );
          _startupResumeCommitted = true;
        }
      }
    } catch (error) {
      if (useJsonl) {
        _commitMcpRecoveryCandidate(
          messages,
          failClosedReplMcpRecoveryCandidate(
            sessionId,
            error,
            "CC_REPL_SESSION_REBUILD_FAILED",
            "session transcript",
          ),
        );
      }
    }
    // settings.json SessionResume hooks: a persisted transcript was just
    // replayed into this interactive session (distinct from SessionStart).
    // Observe-only, best-effort — never blocks entering the REPL.
    if (_settingsHooks && _startupResumeCommitted) {
      try {
        const { runObserveHooks } =
          await import("../lib/settings-hook-events.js");
        runObserveHooks(
          _settingsHooks,
          "SessionResume",
          {
            session_id: sessionId,
            resumed_from: sessionId,
            cwd: process.cwd(),
          },
          { cwd: process.cwd() },
        );
      } catch {
        /* observe-only */
      }
    }
    // Resume recap (offline, extractive — no LLM): a quick "where were we"
    // so the user doesn't have to scroll the old transcript.
    try {
      const { buildResumeRecap } = await import("../lib/repl-rewind.js");
      const recap = buildResumeRecap(messages);
      if (recap) {
        logger.log(chalk.bold("Recap:"));
        for (const line of recap) logger.log(chalk.gray(`  ${line}`));
      }
    } catch (_err) {
      /* non-critical */
    }
  }

  // Create the active session-scoped runtime only after startup recovery has
  // been loaded. Subsequent turns reuse this controller and ledger so a
  // settlement-failure latch cannot be cleared by starting another turn.
  _activateMcpHostRuntime();

  // Advisor is independent from the main agent loop: it gets a redacted
  // transcript snapshot and ZERO tools. Compact call/outcome metadata shares
  // the session hash chain, while advice text itself is never persisted.
  try {
    const { createConfiguredAdvisorRuntime, invokeToolFreeAdvisor } =
      await import("../lib/advisor-runtime.js");
    const advisorOverrides = {};
    if (options.advisorEnabled !== undefined) {
      advisorOverrides.enabled = options.advisorEnabled === true;
    }
    _advisorRuntime = await createConfiguredAdvisorRuntime({
      cwd: process.cwd(),
      settingsFile: options.settingsFile || null,
      managedSettingsFile: options.managedSettingsFile || null,
      mainProvider: provider,
      mainModel: model,
      baseUrl,
      apiKey,
      overrides: advisorOverrides,
      invoke: (request) =>
        _runReplMeteredModelCall({
          callProvider: request?.provider,
          callModel: request?.model,
          source: "model",
          call: ({ signal }) =>
            invokeToolFreeAdvisor({
              ...request,
              signal: combineReplSignals(request?.signal, signal),
            }),
        }),
      onEvent: (event) => {
        if (!useJsonl || !sessionId) return;
        try {
          appendEvent(sessionId, event.type, event.data);
        } catch {
          // Advisor observability is best-effort and cannot fail a main turn.
        }
      },
    });
    // A resumed transcript may contain old tool results. Mark them observed so
    // the first new turn cannot trigger an Advisor call for historical work.
    _advisorRuntime.primeMessages(messages);
  } catch (error) {
    if (error?.code === "CC_MANAGED_SETTINGS_INVALID") throw error;
    _advisorRuntime = null;
    if (options.advisorEnabled === true) {
      logger.warn(`Advisor unavailable: ${error.message}`);
    }
  }

  // Vim mode (Claude-Code `/vim` parity): opt-in modal line editing. `_vim`
  // holds the NORMAL-mode engine state while normal mode is active (readline's
  // own key handling is suspended then); it is null in INSERT mode (readline
  // owns editing). Default off — toggled by `/vim`, or on at startup via
  // --vim / CC_VIM=1.
  let _vimEnabled =
    options.vimMode === true || process.env.CC_VIM === "1" ? true : false;
  let _vim = null;

  // --disable-slash-commands (Claude-Code parity): built-in slash dispatch,
  // custom command macros and MCP prompt expansion are all bypassed — a
  // "/"-leading line reaches the model verbatim, the same fall-through an
  // unmatched slash line already takes. /exit and /quit stay live so the
  // session remains closable from the keyboard.
  const _slashCommandsDisabled =
    options.disableSlashCommands === true ||
    /^(1|true|yes|on)$/i.test(
      String(process.env.CC_DISABLE_SLASH_COMMANDS || "").trim(),
    );

  // --ax-screen-reader / CC_SCREEN_READER: force the mono theme (no ANSI
  // color codes) so output linearizes cleanly. The repainting status line is
  // already killed by the CC_STATUSLINE=0 switch agent.js applies.
  const _screenReaderMode = /^(1|true|yes|on)$/i.test(
    String(process.env.CC_SCREEN_READER || "").trim(),
  );

  // Color theme (Claude-Code `/theme` parity). Capture chalk's auto-detected
  // level BEFORE any theme touches it so `mono`→level 0 stays reversible, then
  // apply the persisted theme (config `cli.theme`). `mono` strips all color;
  // `light` uses a blue prompt accent. Switchable at runtime via `/theme`.
  const {
    DEFAULT_THEME,
    resolveTheme,
    promptAccent,
    applyThemeChalk,
    renderThemeList,
    listThemeNames,
  } = await import("./repl-theme.js");
  const _chalkBaselineLevel = chalk.level;
  let _theme = DEFAULT_THEME;
  try {
    const { getConfigValue } = await import("../lib/config-manager.js");
    _theme = resolveTheme(getConfigValue("cli.theme")) || DEFAULT_THEME;
  } catch (_e) {
    /* config optional — keep default */
  }
  // Screen-reader mode overrides the persisted theme: colors are invisible to
  // a reader and ANSI codes are noise, so run mono for this session (the
  // stored cli.theme is untouched — /theme still shows and can change it).
  if (_screenReaderMode) _theme = "mono";
  applyThemeChalk(_theme, chalk, _chalkBaselineLevel);

  // Fullscreen / no-flicker TUI mode (Claude-Code `/tui` parity). Resolve from
  // CC_NO_FLICKER (forces fullscreen) or persisted `cli.tuiMode`; switchable at
  // runtime via `/tui fullscreen|default`. Screen-reader mode forces default —
  // an alternate screen buffer breaks readers. The heavy renderer lives in
  // fullscreen-tui.js; here we just track the mode and toggle the alt buffer.
  const {
    resolveTuiMode: _resolveTuiMode,
    renderTuiStatus: _renderTuiStatus,
    ALT_SCREEN_ENTER: _ALT_ENTER,
    ALT_SCREEN_LEAVE: _ALT_LEAVE,
  } = await import("./fullscreen-tui.js");
  let _tuiMode = "default";
  try {
    const { getConfigValue } = await import("../lib/config-manager.js");
    _tuiMode = _resolveTuiMode({
      env: process.env.CC_NO_FLICKER,
      setting: getConfigValue("cli.tuiMode"),
    });
  } catch (_e) {
    _tuiMode = _resolveTuiMode({ env: process.env.CC_NO_FLICKER });
  }
  if (_screenReaderMode) _tuiMode = "default";
  const _setTuiMode = (next) => {
    if (next === _tuiMode) return;
    // Enter/leave the alternate screen buffer so the user's scrollback is
    // preserved either way. Only touch a real TTY.
    if (process.stdout.isTTY) {
      process.stdout.write(next === "fullscreen" ? _ALT_ENTER : _ALT_LEAVE);
    }
    _tuiMode = next;
  };
  if (_tuiMode === "fullscreen" && process.stdout.isTTY) {
    process.stdout.write(_ALT_ENTER);
  }

  // Fast mode (Claude-Code `/fast` parity, generalized to a latency profile).
  // When on, the next turn minimizes reasoning and — unless the user pinned a
  // model this session — swaps to the provider's low-latency model. Resolved
  // from config `cli.fastMode`; toggled at runtime via `/fast`. `_modelPinned`
  // tracks an explicit `/model x` so fast mode never overrides a chosen model.
  const {
    parseFastCommand: _parseFastCommand,
    resolveFastPlan: _resolveFastPlan,
    renderFastStatus: _renderFastStatus,
  } = await import("./fast-mode.js");
  let _fastMode = false;
  let _modelPinned = false;
  try {
    const { getConfigValue } = await import("../lib/config-manager.js");
    _fastMode = getConfigValue("cli.fastMode") === true;
  } catch (_e) {
    /* config optional */
  }

  // Voice dictation (Claude-Code `/voice` parity). Local-first STT priority;
  // degrades cleanly on headless/SSH. Real capture is a host binding — probed
  // from config `voice.backends` (map of backend id → true) — so with no
  // backend bundled, `/voice hold` reports how to enable one rather than
  // pretending to listen. `voice.allowCloud` gates cloud transcription.
  const {
    parseVoiceCommand: _parseVoiceCommand,
    resolveSttBackend: _resolveSttBackend,
    detectVoiceEnvironment: _detectVoiceEnvironment,
    renderVoiceStatus: _renderVoiceStatus,
  } = await import("./voice-dictation.js");
  let _voiceMode = "off";
  let _voiceConfig = { backends: {}, allowCloud: false };
  try {
    const { getConfigValue } = await import("../lib/config-manager.js");
    const v = getConfigValue("voice") || {};
    _voiceConfig = {
      backends: v.backends || {},
      allowCloud: v.allowCloud === true,
    };
  } catch (_e) {
    /* config optional */
  }
  const themedPrompt = (text) => {
    const a = promptAccent(_theme);
    if (a === "blue") return chalk.blue(text);
    if (a === "green") return chalk.green(text);
    return text;
  };

  const getPrompt = () => {
    // Mode indicator first so it survives the plan-mode prompt variants.
    const vim = _vimEnabled
      ? _vim
        ? chalk.cyan("[N] ")
        : chalk.dim("[I] ")
      : "";
    const planManager = getPlanModeManager();
    if (planManager.isActive()) {
      const state = planManager.state;
      if (state === PlanState.APPROVED || state === PlanState.EXECUTING) {
        return vim + chalk.green("[plan:exec] > ");
      }
      return vim + chalk.yellow("[plan] > ");
    }
    return vim + themedPrompt("> ");
  };

  // `@` tab-completion (Claude-Code @-mention parity): filesystem paths +
  // (when the IDE bridge is connected) the editor's open tabs ranked first.
  const { makeAtCompleter } = await import("../lib/repl-completer.js");
  const { discoverCommands } = await import("../lib/slash-commands.js");
  const atCompleter = makeAtCompleter({
    // cwd left unset on purpose: the completer resolves process.cwd() lazily
    // so it follows `/cd` mid-session.
    // Keep in sync with the rl.on("line") handlers + /help below.
    // --disable-slash-commands: nothing to complete — "/" input is plain text.
    slashCommands: _slashCommandsDisabled
      ? []
      : [
          "/add-dir",
          "/agents",
          "/advisor",
          "/auto",
          "/btw",
          "/cd",
          "/clear",
          "/compact",
          "/checkup",
          "/config",
          "/context",
          "/copy",
          "/cost",
          "/cowork",
          "/doctor",
          "/effort",
          "/exit",
          "/export",
          "/fast",
          "/goal",
          "/help",
          "/hooks",
          "/ide",
          "/init",
          "/mcp",
          "/memory",
          "/microcompact",
          "/model",
          "/note-next",
          "/output-style",
          "/permissions",
          "/paste-image",
          "/plan",
          "/pr-comments",
          "/profile",
          "/provider",
          "/quit",
          "/recap",
          "/reindex",
          "/release-notes",
          "/reload-plugins",
          "/reload-skills",
          "/remote-control",
          "/review",
          "/rewind",
          "/search",
          "/session",
          "/sessions",
          "/stats",
          "/status",
          "/statusline",
          "/stash",
          "/sub-agents",
          "/suggestions",
          "/task",
          "/tasks",
          "/terminal-setup",
          "/theme",
          "/think",
          "/todos",
          "/tui",
          "/ultrathink",
          "/vim",
          "/voice",
          "/editor",
        ],
    // User/project custom commands (.claude/commands/*.md) join TAB completion
    // alongside the built-ins above. Sync + best-effort; the completer
    // TTL-caches the result so this filesystem walk runs at most once per few
    // seconds, and process.cwd() makes it follow `/cd` mid-session.
    getDynamicSlashCommands: () => {
      if (_slashCommandsDisabled) return [];
      try {
        return discoverCommands(process.cwd()).map((cmd) => `/${cmd.name}`);
      } catch {
        return [];
      }
    },
    getIdeOpenFiles: async () => {
      const hostMcp = _getReplHostMcp();
      const exec = hostMcp?.externalToolExecutors?.mcp__ide__getOpenEditors;
      if (!exec || exec.kind !== "mcp" || !hostMcp?.mcpClient?.callTool) {
        return [];
      }
      const { parseToolResultJson } = await import("../lib/ide-context.js");
      const res = await hostMcp.mcpClient.callTool(
        exec.serverName,
        exec.toolName,
        {},
      );
      const data = parseToolResultJson(res);
      return Array.isArray(data?.editors)
        ? data.editors.map((e) => e?.file).filter(Boolean)
        : [];
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPrompt(),
    terminal: true,
    completer: atCompleter,
  });
  // Let the EPIPE guard route a broken pipe through this interface's graceful
  // "close" cleanup instead of a bare exit.
  _replRl = rl;

  // Prompt-side interaction modules share the production readline surface.
  // A per-REPL registry avoids singleton handlers retaining an old session.
  const _clipboardBinding = Object.prototype.hasOwnProperty.call(
    options,
    "clipboardBinding",
  )
    ? options.clipboardBinding
    : createSystemClipboardImageBinding();
  const _promptInteractionSurface = createPromptInteractionSurface({
    readline: rl,
    config: _promptInteractionConfig,
    keybindings: _promptInteractionConfig,
    getSessionId: () => sessionId,
    getSuggestionContext: () => ({ messages: messages.slice() }),
    persistSuggestionEnabled: _persistPromptSuggestionsEnabled,
    clipboardBinding: _clipboardBinding,
    generateSuggestions: resolveReplPromptSuggestionGenerator(
      useJsonl,
      options.generatePromptSuggestions,
    ),
    suggestionDebounceMs: options.promptSuggestionDebounceMs,
    screenReader: _screenReaderMode,
    write: (text) => process.stdout.write(String(text)),
    writeError: (text) => process.stderr.write(String(text)),
    getColumns: () => process.stdout.columns || 80,
  });
  const _promptInteractions = _promptInteractionSurface.controller;
  for (const diagnostic of _promptInteractions.diagnostics().keybindingErrors) {
    logger.warn(`prompt keybinding ignored: ${diagnostic}`);
  }

  // MCP elicitation in the interactive REPL uses the same readline surface as
  // approvals, while MCPClient retains the protocol-level response shape.
  const mcpElicitationClients = [_adhocMcp?.mcpClient, _bundleMcpClient].filter(
    (client) => client?.setElicitationHandler,
  );
  for (const client of mcpElicitationClients) {
    client.setElicitationHandler(
      (request) =>
        new Promise((resolve) => {
          const label =
            request.message || "MCP server requests additional input";
          if (request.mode === "url") {
            rl.question(
              chalk.yellow(
                `\n  MCP [${request.server}] ${label}\n` +
                  `  Host: ${request.urlHost}\n` +
                  `  URL: ${request.url}\n` +
                  "  Open this secure page? [y/N] ",
              ),
              async (answer) => {
                const approved = /^(y|yes)$/i.test(String(answer || "").trim());
                if (!approved) {
                  resolve({ action: "decline" });
                  rl.prompt();
                  return;
                }
                try {
                  const { defaultOpenBrowser } =
                    await import("../lib/mcp-oauth.js");
                  const opened = defaultOpenBrowser(request.url);
                  resolve(opened ? { action: "accept" } : { action: "cancel" });
                } catch {
                  resolve({ action: "cancel" });
                }
                rl.prompt();
              },
            );
            return;
          }
          rl.question(
            chalk.yellow(`\n  MCP [${request.server}] ${label}\n  > `),
            (answer) => {
              const trimmed = String(answer || "").trim();
              if (!trimmed) {
                resolve({ action: "cancel" });
              } else {
                let content = { value: trimmed };
                try {
                  const parsed = JSON.parse(trimmed);
                  if (parsed && typeof parsed === "object") content = parsed;
                } catch {
                  // Plain text remains a valid single-field elicitation answer.
                }
                resolve({ action: "accept", content });
              }
              rl.prompt();
            },
          );
        }),
      { timeoutMs: options.mcpElicitationTimeoutMs },
    );
  }

  // Inbound channels (--channels, gap-2026-07-11 P0#5): external events enter
  // this session as user turns. rl.emit("line") reuses the REPL's own input
  // path, so an event landing mid-turn queues behind it (pending-lines), and
  // the [channel:...] prefix keeps provenance visible while guaranteeing the
  // injected line can never read as a slash command or shell escape.
  let _channels = null;
  if (options.channels) {
    try {
      const { startChannels, formatChannelEvent } =
        await import("../lib/channels/channel-manager.js");
      let channelsConfig = {};
      try {
        channelsConfig =
          (await import("../lib/config-manager.js")).loadConfig()?.channels ||
          {};
      } catch (_err) {
        // config read is best-effort; channels validate their own inputs
      }
      _channels = await startChannels(options.channels, {
        config: channelsConfig,
        onEvent: (event) => rl.emit("line", formatChannelEvent(event)),
        log: (msg) => logger.info(msg),
      });
      for (const c of _channels.channels) {
        logger.info(`channel ready: ${c.describe}`);
      }
    } catch (err) {
      logger.warn(`channels: ${err.message}`);
    }
  }

  // Vim-mode plumbing: capture readline's OWN keypress listeners now so we can
  // suspend them while in NORMAL mode (the engine drives editing then) and
  // reattach them for INSERT mode (readline's rich editing/history/completion).
  const _nativeReadlineKeypressListeners = process.stdin.isTTY
    ? process.stdin.listeners("keypress").slice()
    : [];
  const _consumedReadlineKeypresses = new WeakSet();
  const _consumeReadlineKeypress = (key) => {
    if (key && typeof key === "object") _consumedReadlineKeypresses.add(key);
  };
  const _rlKeypressListeners = _nativeReadlineKeypressListeners.map(
    (listener) =>
      function guardedReadlineKeypress(input, key) {
        if (
          key &&
          typeof key === "object" &&
          _consumedReadlineKeypresses.has(key)
        ) {
          return;
        }
        return listener.call(this, input, key);
      },
  );
  if (process.stdin.isTTY) {
    for (const listener of _nativeReadlineKeypressListeners) {
      process.stdin.removeListener("keypress", listener);
    }
    for (const listener of _rlKeypressListeners) {
      process.stdin.on("keypress", listener);
    }
  }
  const _suspendReadlineKeys = () => {
    for (const l of _rlKeypressListeners)
      process.stdin.removeListener("keypress", l);
  };
  const _resumeReadlineKeys = () => {
    const cur = process.stdin.listeners("keypress");
    for (const l of _rlKeypressListeners)
      if (!cur.includes(l)) process.stdin.on("keypress", l);
  };
  // Push the engine's line/cursor onto readline and redraw the current line.
  const _vimSync = (vstate) => {
    try {
      rl.line = vstate.line;
      rl.cursor = Math.max(0, Math.min(vstate.cursor, vstate.line.length));
      if (typeof rl._refreshLine === "function") rl._refreshLine();
    } catch {
      /* redraw is best-effort */
    }
  };
  const _vimEnterNormal = () => {
    const cur = Math.max(
      0,
      Math.min(rl.cursor, Math.max(0, rl.line.length - 1)),
    );
    _vim = { ...createVimState(rl.line, cur), mode: "normal" };
    _suspendReadlineKeys();
    rl.setPrompt(getPrompt());
    _vimSync(_vim);
  };
  const _vimEnterInsert = (vstate) => {
    _resumeReadlineKeys();
    _vim = null;
    rl.setPrompt(getPrompt());
    _vimSync(vstate);
  };
  // Exposed so /vim can leave normal mode cleanly when disabling.
  const _vimDisable = () => {
    if (_vim) _resumeReadlineKeys();
    _vim = null;
    _vimEnabled = false;
  };

  // Esc interrupt (Claude-Code parity): pressing Esc while a turn is in
  // flight aborts the in-flight agentLoop through its existing AbortSignal
  // seam (throwIfAborted at each iteration); partial conversation is kept.
  // Idle Esc presses (no active turn) are ignored, and escape-prefixed key
  // sequences (arrows etc.) never reach here as bare "escape".
  _turnAbort = null;
  let _lastIdleEscAt = 0;
  let _replKeypressHandler = null;
  if (process.stdin.isTTY) {
    _replKeypressHandler = (_str, key) => {
      const k = key || {};
      // 1) Turn abort always wins, regardless of vim mode.
      if (k.name === "escape" && !k.meta && _turnAbort) {
        _consumeReadlineKeypress(key);
        process.stdout.write(chalk.yellow("\n⎋ interrupting…\n"));
        try {
          _turnAbort.abort();
        } catch {
          /* already aborted */
        }
        _turnAbort = null;
        // settings.json SessionPause hooks: the user interrupted the in-flight
        // turn — the session stays open, the current work is suspended. The
        // keypress handler can't await, so fire observe-only fire-and-forget.
        if (_settingsHooks) {
          import("../lib/settings-hook-events.js")
            .then(({ runObserveHooks }) =>
              runObserveHooks(
                _settingsHooks,
                "SessionPause",
                {
                  session_id: sessionId,
                  reason: "user-interrupt",
                  cwd: process.cwd(),
                },
                { cwd: process.cwd() },
              ),
            )
            .catch(() => {});
        }
        return;
      }

      // 1.5) Shift+Tab cycles the session approval tier (Claude-Code mode
      // cycling): strict → trusted → autopilot → strict. Drives the existing
      // ApprovalGate.setSessionPolicy seam; intercepted before vim/completion.
      const isShiftTab =
        (k.name === "tab" && k.shift) || k.sequence === "\u001b[Z";
      if (isShiftTab) {
        _consumeReadlineKeypress(key);
        if (
          _approvalGate &&
          sessionId &&
          typeof _approvalGate.setSessionPolicy === "function"
        ) {
          // "auto" rides the trusted tier, so it cycles as trusted → autopilot
          // (cycling is also how you exit auto mode without /permissions).
          const next = nextTier(gateTierFor(_sessionTier));
          try {
            _approvalGate.setSessionPolicy(sessionId, next);
            _sessionTier = next;
            process.stdout.write(
              "\n" +
                chalk.cyan(`⇥ approval: ${next}`) +
                " " +
                chalk.gray(`(${describeTier(next)})`) +
                "\n",
            );
            if (!_turnAbort) prompt();
          } catch {
            process.stdout.write("\x07"); // bell on failure
          }
        } else {
          process.stdout.write("\x07"); // no gate this session
        }
        return;
      }

      // 1.75) Prompt interaction keybindings share the controller used by
      // slash commands. They are idle-only and stay out of Vim NORMAL mode,
      // where the modal editor owns every key.
      if (
        !_turnAbort &&
        (!_vimEnabled || !_vim) &&
        _promptInteractions.handleKeypress(_str, k)
      ) {
        _consumeReadlineKeypress(key);
        return;
      }

      // 1.875) The opt-in readline flavor makes Ctrl+W a whitespace-delimited
      // unix-word-rubout. Classic stays byte-identical and lets Node readline
      // own the chord; Vim NORMAL mode continues to use the existing engine.
      if (
        !_turnAbort &&
        (!_vimEnabled || !_vim) &&
        _keybindingFlavor === "readline" &&
        isReadlineWordRuboutKey(_str, k)
      ) {
        _consumeReadlineKeypress(key);
        const next = readlineWordRubout(rl.line, rl.cursor);
        if (next.changed) {
          rl.line = next.line;
          rl.cursor = next.cursor;
          rl._refreshLine?.();
        }
        return;
      }

      // 2) Vim mode: modal editing on the current input line.
      if (_vimEnabled && !_turnAbort) {
        if (!_vim) {
          // INSERT mode — readline owns the keys; Esc switches to NORMAL.
          if (k.name === "escape" && !k.meta) {
            _consumeReadlineKeypress(key);
            _vimEnterNormal();
          }
          return;
        }
        // NORMAL mode — readline suspended; the engine interprets every key.
        _consumeReadlineKeypress(key);
        const res = feedNormalKey(_vim, _str || "", k);
        if (res.submit) {
          // Hand the line to readline as a normal Enter (fires 'line', clears).
          _vimEnterInsert({ ...res, cursor: res.line.length });
          process.stdin.emit("keypress", "\r", { name: "return" });
          return;
        }
        if (res.mode === "insert") {
          _vimEnterInsert(res);
          return;
        }
        _vim = res;
        if (res.message === "bell") process.stdout.write("\x07");
        else if (res.notice)
          process.stdout.write("\n" + chalk.gray(res.notice) + "\n");
        _vimSync(res);
        return;
      }

      // 3) Non-vim: double-Esc while idle → rewind picker shortcut.
      if (k.name !== "escape" || k.meta) return;
      _consumeReadlineKeypress(key);
      const nowTs = Date.now();
      if (nowTs - _lastIdleEscAt < 600) {
        _lastIdleEscAt = 0;
        import("../lib/repl-rewind.js")
          .then(({ listUserTurns, renderTurnList }) => {
            process.stdout.write(
              chalk.bold("\nRewind — pick a user turn (newest first):\n"),
            );
            process.stdout.write(
              `${renderTurnList(listUserTurns(messages))}\n`,
            );
            process.stdout.write(
              chalk.gray(
                _checkpointMarks.length
                  ? "Run /rewind <n> to rewind the conversation (and optionally its files).\n"
                  : "Run /rewind <n> to rewind the conversation.\n",
              ),
            );
            prompt();
          })
          .catch(() => {});
      } else {
        _lastIdleEscAt = nowTs;
      }
    };
    process.stdin.prependListener("keypress", _replKeypressHandler);
  }

  logger.log(chalk.bold("\nChainlessChain Agent"));
  logger.log(
    chalk.gray(`Model: ${model}  Provider: ${provider}  CWD: ${process.cwd()}`),
  );
  if (sessionId) {
    logger.log(chalk.gray(`Session: ${sessionId}`));
  }
  if (db) {
    logger.log(chalk.gray("Context: instinct + memory + notes (DB connected)"));
  }
  logger.log(
    chalk.gray(
      "Describe what you want to do. I can read/write files, run commands, and more.",
    ),
  );
  logger.log(chalk.gray("Type /exit to quit, /help for commands\n"));

  // Version-skew reminder: if cc was updated on disk after this REPL spawned, it
  // is still running the old in-memory code (a fixed bug then looks "not fixed").
  // Tell the user to restart so the update takes effect. Checked at startup AND
  // again before each turn (see handleLine) so a mid-session `npm i -g` is
  // caught on the next prompt; emitted at most once. Best-effort.
  let _versionSkewNotified = false;
  const _notifyVersionSkew = async () => {
    if (_versionSkewNotified) return;
    try {
      const { detectVersionSkew, versionSkewMessage } =
        await import("../lib/version-skew.js");
      const skew = detectVersionSkew();
      if (skew) {
        _versionSkewNotified = true;
        logger.log(chalk.yellow(`⚠️  ${versionSkewMessage(skew)}\n`));
      }
    } catch {
      /* version-skew notice is best-effort */
    }
  };
  await _notifyVersionSkew();

  // statusLine (Claude-Code parity): a line above the prompt each turn.
  //  - A user-configured `.claude/settings.json` `statusLine` command wins
  //    (model / branch / cost / … — first stdout line; best-effort, sync).
  //  - Otherwise a BUILT-IN context-usage line is shown: model · ⛁ used/window
  //    (pct%) · cwd · turn N — the "上下文用量显示" half. Default-on.
  //  - Suppressed entirely by `statusLine: false`, env CC_STATUSLINE=0, or
  //    `/statusline off`. Token usage is fed in from each turn's usage events.
  let _statusLineEnabled = process.env.CC_STATUSLINE !== "0";
  let _customStatus = false; // true when a settings.json command is configured
  let _curModel = model; // tracks the per-turn active model for the readout
  let _ctxUsedTokens = 0;
  let _turnCount = 0;
  const _costStore = newCostStore(); // running token spend for `/cost`
  let _renderStatus = null;
  try {
    const slm = await import("../lib/status-line.js");
    const _sl = slm.default || slm;
    const _slCfg = _sl.loadStatusLineConfig({ cwd: process.cwd() });
    _customStatus = !!_slCfg;
    const _slDisabled = _sl.isStatusLineDisabled({ cwd: process.cwd() });
    if (_slDisabled) _statusLineEnabled = false;
    _renderStatus = () => {
      if (!_statusLineEnabled) return null;
      try {
        const context = _sl.buildContext({
          sessionId,
          model: _curModel,
          provider,
          cwd: process.cwd(),
          usedTokens: _ctxUsedTokens,
          contextWindow: getContextWindow(_curModel, provider),
          turn: _turnCount,
        });
        // Custom command wins; otherwise the built-in context-usage render.
        if (_slCfg) {
          return _sl.renderStatusLine(_slCfg, context, {
            cwd: process.cwd(),
          });
        }
        const line = _sl.renderDefaultStatusLine(context);
        return line && line.trim() ? line : null;
      } catch {
        return null; // never let the status line break the REPL
      }
    };
  } catch {
    _renderStatus = null;
  }

  const prompt = () => {
    if (_statusLineEnabled && _renderStatus) {
      const line = _renderStatus();
      // Built-in line is dimmed; a custom command may carry its own ANSI.
      if (line)
        process.stdout.write((_customStatus ? line : chalk.dim(line)) + "\n");
    }
    rl.setPrompt(getPrompt());
    rl.prompt();
  };

  // Fire SessionStart hook (fire-and-forget; hook failures never break REPL)
  await fireSessionHook(_hookDb, HookEvents.SessionStart, {
    sessionId,
    provider,
    model,
    cwd: process.cwd(),
  });

  prompt();

  // Steering (Claude-Code parity): typing while a turn is running QUEUES the
  // line instead of racing a second concurrent turn; the queue drains FIFO
  // when the current turn finishes. `/btw` is the deliberate exception: its
  // tool-free snapshot call may run concurrently without mutating main state.
  const runBtwSideQuestion = async (btw, { concurrent = false } = {}) => {
    if (!btw || btw.error) {
      const message = btw?.error || "usage: /btw [--fork] <question>";
      if (concurrent) process.stderr.write(`\n${message}\n`);
      else logger.info(message);
      return { ok: false, error: message };
    }
    try {
      const chatFn = createChatFn({
        provider,
        model,
        baseUrl,
        apiKey,
        callWrapper: _directChatCallWrapper,
      });
      const { answer } = await runBtwQuestion({
        messages,
        question: btw.text,
        chatFn,
        model,
      });
      let forkedId = null;
      let forkNotice = "";
      if (btw.fork) {
        if (useJsonl && sessionId && sessionExists(sessionId)) {
          forkedId = forkSession(sessionId, {
            requestId: `btw-${randomUUID()}`,
          });
          if (forkedId) {
            appendUserMessage(forkedId, btw.text);
            appendAssistantMessage(forkedId, answer);
            forkNotice = `\nForked side thread: ${forkedId}`;
          }
        }
        if (!forkedId) {
          forkNotice =
            "\nSide answer was not persisted: the parent has no durable JSONL session.";
        }
      }
      const block =
        `┌─ btw${btw.fork ? " --fork" : ""}\n` +
        `${answer || "(empty response)"}\n` +
        `└─ ephemeral · no tools · parent history unchanged${forkNotice}`;
      // A concurrent answer must not corrupt the main streamed stdout payload.
      // stderr also keeps headless/JSON consumers isolated from the overlay.
      if (concurrent) process.stderr.write(`\n${block}\n`);
      else logger.log(`\n${block}\n`);
      return { ok: true, answer, forkedId };
    } catch (error) {
      const terminalError = _runtimeLedgerTerminalLatch.trip(error);
      if (terminalError) {
        _reportRuntimeLedgerTerminal({ concurrent });
        return { ok: false, error: terminalError.message, terminal: true };
      }
      const message = `/btw failed: ${error.message}`;
      if (concurrent) process.stderr.write(`\n${message}\n`);
      else logger.error(message);
      return { ok: false, error: message };
    }
  };

  // Multiline input (Claude-Code parity): a physical line ending in a
  // continuation backslash keeps the prompt open; `_mlBuffer` accumulates the
  // pieces and the whole block submits when a line does not continue.
  const _mlBuffer = [];
  const handleLine = async (input) => {
    // Backslash continuation — accumulate and re-prompt without firing a turn.
    const _cont = analyzeContinuation(input);
    if (_cont.continued) {
      _mlBuffer.push(_cont.text);
      rl.setPrompt(chalk.dim("... "));
      rl.prompt();
      return;
    }
    if (_mlBuffer.length) {
      input = joinContinuation(_mlBuffer, input);
      _mlBuffer.length = 0;
    }

    const rawLine = input.trim();
    // --disable-slash-commands: hide "/"-leading input from every built-in
    // slash handler below by dispatching a sentinel no handler can match; the
    // turn tail restores the user's real text (promptText), so the line goes
    // to the model verbatim — the same fall-through an unmatched slash line
    // already takes. /exit and /quit stay live so the session can be closed.
    // Predicate + sentinel are pure (lib/slash-dispatch.js, unit-tested).
    const { slashDispatchBypassed, slashBypassSentinel } =
      await import("../lib/slash-dispatch.js");
    const _slashBypassed = slashDispatchBypassed(
      rawLine,
      _slashCommandsDisabled,
    );
    const trimmed = _slashBypassed ? slashBypassSentinel() : rawLine;
    if (!trimmed) {
      prompt();
      return;
    }
    if (
      _runtimeLedgerTerminalLatch.isTripped() &&
      trimmed !== "/exit" &&
      trimmed !== "/quit"
    ) {
      _pendingLines.length = 0;
      _reportRuntimeLedgerTerminal();
      prompt();
      return;
    }

    // Per-turn version-skew check (one-time): catches an `npm i -g` that landed
    // while this REPL kept running — the next prompt nudges a restart.
    await _notifyVersionSkew();

    // `!` bash passthrough (Claude-Code parity): run the command right here —
    // no LLM round-trip — and fold the output into the conversation context.
    if (trimmed.startsWith("!") && trimmed.slice(1).trim()) {
      try {
        const { runBangCommand, shouldRespondToBashCommands } =
          await import("../lib/repl-bang-memorize.js");
        const res = runBangCommand(trimmed, { cwd: process.cwd() });
        logger.log(chalk.gray(`$ ${res.cmd}`));
        if (res.stdout)
          process.stdout.write(
            res.stdout.endsWith("\n") ? res.stdout : `${res.stdout}\n`,
          );
        if (res.stderr)
          process.stderr.write(
            chalk.red(
              res.stderr.endsWith("\n") ? res.stderr : `${res.stderr}\n`,
            ),
          );
        if (res.error) logger.error(`shell error: ${res.error.message}`);
        logger.log(chalk.gray(`(exit ${res.exitCode})`));
        // Claude-Code 2.1.186 `respondToBashCommands` (opt-in, default OFF):
        // when enabled, the assistant automatically responds to the command
        // output. Re-dispatch the captured <bash-input>/<bash-output> as a
        // normal user turn so the FULL turn machinery (streaming render, tools,
        // session persistence) is reused — the bash-tagged content can't
        // re-trigger the `!` branch.
        if (shouldRespondToBashCommands({ settingValue: _respondToBash })) {
          await handleLine(res.contextMessage.content);
          return; // the nested turn already re-prompted
        }
        messages.push(res.contextMessage);
      } catch (err) {
        logger.error(`! command failed: ${err.message}`);
      }
      prompt();
      return;
    }

    // `#` quick-memorize (Claude-Code parity): append a note to the project
    // cc.md (auto-loaded next session) and keep it active in this one.
    if (trimmed.startsWith("#") && trimmed.slice(1).trim()) {
      try {
        const { appendMemoryNote } =
          await import("../lib/repl-bang-memorize.js");
        const res = appendMemoryNote(trimmed, { cwd: process.cwd() });
        messages.push({
          role: "system",
          content: `<memory-note source="${res.target}">${res.note}</memory-note>`,
        });
        logger.log(
          chalk.green(
            `✔ remembered in ${res.target}${res.created ? " (created)" : ""}`,
          ),
        );
      } catch (err) {
        logger.error(`# memorize failed: ${err.message}`);
      }
      prompt();
      return;
    }

    // Slash commands
    if (trimmed === "/exit" || trimmed === "/quit") {
      logger.log(chalk.gray("\nGoodbye!"));
      rl.close();
      return;
    }

    // The interaction commands are registered through the shared registry,
    // while the mature REPL handlers below remain on their existing direct
    // paths. --disable-slash-commands replaces `trimmed` with a sentinel, so
    // it cannot accidentally reach this dispatcher.
    if (trimmed.startsWith("/")) {
      const commandName = trimmed.split(/\s+/, 1)[0];
      if (_promptInteractionSurface.commandNames.has(commandName)) {
        await _promptInteractionSurface.dispatchSlash(trimmed);
        prompt();
        return;
      }
    }

    if (trimmed === "/help") {
      logger.log(chalk.bold("\nCommands:"));
      logger.log(
        `  ${chalk.cyan("! <cmd>")}     Run a shell command directly (output joins context)`,
      );
      logger.log(
        `  ${chalk.cyan("# <note>")}    Remember a note in the project cc.md`,
      );
      logger.log(
        `  ${chalk.cyan("… \\")}         End a line with \\ to continue input onto the next line`,
      );
      logger.log(
        `  ${chalk.cyan("/exit")}       Exit the agent (alias: /quit)`,
      );
      logger.log(
        `  ${chalk.cyan("/model")}      Show/change model (/model <name>)`,
      );
      logger.log(`  ${chalk.cyan("/provider")}   Show/change provider`);
      logger.log(
        `  ${chalk.cyan("/think")}      Extended thinking on/off (/think [on|off|ultra]; /ultrathink = max; Anthropic)`,
      );
      logger.log(
        `  ${chalk.cyan("/effort")}     Reasoning effort (/effort low|medium|high|xhigh; Anthropic)`,
      );
      logger.log(
        `  ${chalk.cyan("/btw")}        Ask an immediate tool-free side question (/btw [--fork] <question>)`,
      );
      logger.log(
        `  ${chalk.cyan("/advisor")}    Independent tool-free critic (/advisor on|off|once [focus]|status)`,
      );
      logger.log(
        `  ${chalk.cyan("/note-next")}  Apply ephemeral guidance to the next main turn`,
      );
      logger.log(`  ${chalk.cyan("/clear")}      Clear conversation`);
      logger.log(
        `  ${chalk.cyan("/vim")}        Toggle vim-mode line editing (/vim [on|off]; Esc → NORMAL)`,
      );
      logger.log(
        `  ${chalk.cyan("/terminal-setup")} Bind Shift+Enter → newline (--apply for VS Code)`,
      );
      logger.log(
        `  ${chalk.cyan("/statusline")} Context-usage line on/off (/statusline [on|off])`,
      );
      logger.log(
        `  ${chalk.cyan("/theme")}      Color theme (/theme <auto|dark|light|mono>; mono = no color)`,
      );
      logger.log(
        `  ${chalk.cyan("/tui")}        Fullscreen no-flicker view (/tui <fullscreen|default>; CC_NO_FLICKER=1)`,
      );
      logger.log(
        `  ${chalk.cyan("/fast")}       Latency profile — faster+cheaper, less reasoning (/fast on|off|status)`,
      );
      logger.log(
        `  ${chalk.cyan("/voice")}      Speech dictation — local-first STT (/voice hold|tap|off)`,
      );
      logger.log(
        `  ${chalk.cyan("/output-style")} Response persona (/output-style <name|list>; concise/explanatory/learning built-in)`,
      );
      logger.log(
        `  ${chalk.cyan("/editor")}     Edit a draft prompt in an external editor`,
      );
      logger.log(
        `  ${chalk.cyan("/stash")}      Stash/list/pop/clear draft prompts`,
      );
      logger.log(
        `  ${chalk.cyan("/recap")}      Show a lightweight session recap`,
      );
      logger.log(
        `  ${chalk.cyan("/suggestions")} Prompt suggestions on|off|status|refresh`,
      );
      logger.log(
        `  ${chalk.cyan("/paste-image")} Attach a clipboard image from a supporting host`,
      );
      logger.log(
        `  ${chalk.cyan("/config")}     Show config; ${chalk.cyan("/config <key>")} read, ${chalk.cyan("/config <key>=<val>")} set, ${chalk.cyan("/config --help")} keys`,
      );
      logger.log(
        `  ${chalk.cyan("/doctor")}     Session health check (provider/key/IDE/MCP/hooks; alias /checkup)`,
      );
      logger.log(
        `  ${chalk.cyan("/status")}     Environment snapshot (version/model/session/cwd/roots/IDE·MCP·hooks)`,
      );
      logger.log(
        `  ${chalk.cyan("/release-notes")} Running version + changelog links + how to upgrade`,
      );
      logger.log(
        `  ${chalk.cyan("/memory")}     Project-memory files loaded (cc.md hierarchy + rules)`,
      );
      logger.log(
        `  ${chalk.cyan("/init")}       Inventory this folder into a cc.md project-memory file (/init [--force])`,
      );
      logger.log(
        `  ${chalk.cyan("/context")}    Live context-window usage by role + MCP tool schemas`,
      );
      logger.log(
        `  ${chalk.cyan("/copy")}       Copy last response to clipboard (/copy code → last code block)`,
      );
      logger.log(
        `  ${chalk.cyan("/cost")}       Session token spend + estimated $ (per model & category)`,
      );
      logger.log(
        `  ${chalk.cyan("/permissions")} Allow/ask/deny rules; set/cycle tier (/permissions <tier> · Shift+Tab); /permissions denials to review blocked calls`,
      );
      logger.log(
        `  ${chalk.cyan("/remote-control")} Answer permission prompts from a paired phone/web device (on|off|status; alias /rc)`,
      );
      logger.log(
        `  ${chalk.cyan("/export")}     Save this conversation to a Markdown file (/export [path])`,
      );
      logger.log(
        `  ${chalk.cyan("/rewind")}     Rewind to an earlier turn (double-Esc lists); ${chalk.cyan("/rewind <n> --files|--conversation")} scopes it; ${chalk.cyan("/rewind <n> --branch")} forks a session; ${chalk.cyan("/rewind clear")} restores a /clear`,
      );
      logger.log(
        `  ${chalk.cyan("/goal <cond>")} Set a session goal checked after each turn (exit-zero:/file-exists:/contains:/regex:/text); ${chalk.cyan("/goal")} shows, ${chalk.cyan("/goal clear")} drops`,
      );
      logger.log(
        `  ${chalk.cyan("/cd <dir>")}   Change working directory mid-session (completion/memory follow)`,
      );
      logger.log(
        `  ${chalk.cyan("/add-dir")}    Add an extra working root (/add-dir <dir>; no arg lists roots)`,
      );
      logger.log(
        `  ${chalk.cyan("/reload-skills")} Revoke process Skill grants and re-scan layers`,
      );
      logger.log(
        `  ${chalk.cyan("/reload-plugins")} Re-scan installed plugins after add/trust/upgrade`,
      );
      logger.log(
        `  ${chalk.cyan("/review")}     Diff-first code review (/review [high] [--security|--simplify] [--fix])`,
      );
      logger.log(
        `  ${chalk.cyan("/pr-comments")} Fetch a GitHub PR's comments and address them (/pr-comments [<n>] [--repo o/r]; needs gh)`,
      );
      logger.log(
        `  ${chalk.cyan("/compact")}    Smart compact (importance-based)`,
      );
      logger.log(
        `  ${chalk.cyan("/microcompact")} Trim large OLD tool results in place (keeps recent + flow)`,
      );
      logger.log(
        `  ${chalk.cyan("/task")}       Set task objective (/task <objective>)`,
      );
      logger.log(`  ${chalk.cyan("/task clear")} Clear current task`);
      logger.log(`  ${chalk.cyan("/session")}    Show current session info`);
      logger.log(
        `  ${chalk.cyan("/sessions")}   List recent resumable sessions (/session resume <id> to switch)`,
      );
      logger.log(
        `  ${chalk.cyan("/reindex")}    Reindex notes for BM25 search`,
      );
      logger.log(
        `  ${chalk.cyan("/stats")}      Show context engine statistics`,
      );
      logger.log(
        `  ${chalk.cyan("/auto")}       Autonomous goal execution (ReAct loop)`,
      );
      logger.log(
        `  ${chalk.cyan("/cowork")}     Multi-agent collaboration (debate, compare)`,
      );
      logger.log(
        `  ${chalk.cyan("/search")}     Search past sessions (/search <query>)`,
      );
      logger.log(
        `  ${chalk.cyan("/profile")}    Show/edit user profile (USER.md)`,
      );
      logger.log(
        `  ${chalk.cyan("/plan")}       Enter plan mode (read-only analysis first)`,
      );
      logger.log(`  ${chalk.cyan("/plan show")}  Show current plan`);
      logger.log(
        `  ${chalk.cyan("/plan approve")} Approve and execute the plan`,
      );
      logger.log(`  ${chalk.cyan("/plan reject")}  Reject the plan`);
      logger.log(
        `  ${chalk.cyan("/agents")}     Manage sub-agent definitions (/agents [show|new] <name>; cc agents)`,
      );
      logger.log(
        `  ${chalk.cyan("/sub-agents")}  Show active/completed sub-agents`,
      );
      logger.log(
        `  ${chalk.cyan("/tasks")}      Show background shell tasks (kill <id> · kill-all)`,
      );
      logger.log(
        `  ${chalk.cyan("/todos")}      Show the session TODO list (what the agent tracks with todo_write)`,
      );
      logger.log(
        `  ${chalk.cyan("/ide")}        IDE bridge status (connected editor, tools, or why not)`,
      );
      logger.log(
        `  ${chalk.cyan("/mcp")}        MCP server status + tools (/mcp <name> for one server)`,
      );
      logger.log(
        `  ${chalk.cyan("/hooks")}      Loaded .claude/settings.json hooks (cc hook for observe-only DB hooks)`,
      );
      logger.log(chalk.bold("\nCapabilities:"));
      logger.log("  Read, write, and edit files");
      logger.log("  Run shell commands (git, npm, etc.)");
      logger.log("  Search codebase by filename or content");
      logger.log("  Run 138 built-in skills (code-review, summarize, etc.)");
      logger.log("  Plan mode: analyze first, execute after approval");
      logger.log(
        "  Context engineering: instinct + memory + notes injection\n",
      );
      // User-defined command macros (.claude/commands/*.md) become runnable
      // slash commands here — list whatever is discovered so they're visible.
      try {
        const { discoverCommands } = await import("../lib/slash-commands.js");
        const macros = discoverCommands(process.cwd());
        if (macros.length > 0) {
          logger.log(chalk.bold("Custom commands (.claude/commands):"));
          for (const m of macros) {
            const tag =
              m.scope === "project"
                ? chalk.cyan("[proj]")
                : chalk.gray("[pers]");
            logger.log(
              `  ${chalk.cyan("/" + m.name)} ${tag}` +
                (m.argumentHint ? chalk.dim(` ${m.argumentHint}`) : "") +
                (m.description ? `  ${chalk.gray(m.description)}` : ""),
            );
          }
          logger.log("");
        }
      } catch (_err) {
        // Non-critical — macro discovery failure must not break /help
      }
      prompt();
      return;
    }

    // `/tasks` — user-facing view of the agent's background shell tasks
    // (run_shell run_in_background). Must precede the `/task` handler below,
    // which matches with startsWith("/task") and would otherwise swallow it.
    if (trimmed === "/tasks" || trimmed.startsWith("/tasks ")) {
      const rest = trimmed.slice("/tasks".length).trim();
      if (rest === "kill-all") {
        const n = killAllBackgroundShellTasks();
        logger.log(chalk.dim(`Killed ${n} background shell task(s).`));
      } else if (rest.startsWith("kill ")) {
        const id = rest.slice("kill ".length).trim();
        const ok = id ? killBackgroundShellTask(id) : false;
        logger.log(
          ok
            ? chalk.dim(`Killed background shell task ${id}.`)
            : chalk.dim(`No running background shell task with id "${id}".`),
        );
      } else if (rest === "kill") {
        logger.log(chalk.dim("Usage: /tasks kill <id> · /tasks kill-all"));
      } else {
        logger.log(
          "\n" + formatBackgroundTasks(listBackgroundShellTasks()) + "\n",
        );
      }
      prompt();
      return;
    }

    // `/todos` — the session's TODO list (what the agent tracks with the
    // todo_write tool). Read-only view; the data lives in todo-manager keyed by
    // sessionId (same store the tool writes). Claude-Code /todos parity.
    if (trimmed === "/todos" || trimmed === "/todo") {
      try {
        const { getTodos } = await import("../lib/todo-manager.js");
        const { formatTodos } = await import("./todos-status.js");
        logger.log("\n" + formatTodos(getTodos(sessionId)) + "\n");
      } catch (err) {
        logger.error(chalk.red(`/todos failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/hooks` — the decision-capable .claude/settings.json `hooks` block loaded
    // for this session (PreToolUse/PostToolUse/…). Observe-only DB hooks
    // (`cc hook add`) are managed via the `cc hook` CLI. Claude-Code /hooks parity.
    if (trimmed === "/hooks" || trimmed.startsWith("/hooks ")) {
      try {
        const { formatSettingsHooks } = await import("./hooks-status.js");
        logger.log("\n" + formatSettingsHooks(_settingsHooks) + "\n");
      } catch (err) {
        logger.error(chalk.red(`/hooks failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/add-dir [dir]` — add an extra working root mid-session (or, with no
    // arg, list the current roots). The new root is threaded into every
    // subsequent turn's options.additionalDirectories (so read/search/edit span
    // it) and re-advertised in the system prompt. Claude-Code /add-dir parity.
    if (trimmed === "/add-dir" || trimmed.startsWith("/add-dir ")) {
      const arg = trimmed.slice("/add-dir".length).trim();
      try {
        const {
          resolveAddDir,
          formatAddDirRoots,
          workspaceRootDirs,
          notifyMcpRootsChanged,
        } = await import("./add-dir.js");
        if (!arg) {
          logger.log(
            "\n" +
              formatAddDirRoots(process.cwd(), additionalDirectories) +
              "\n",
          );
        } else {
          const res = resolveAddDir(arg, {
            cwd: process.cwd(),
            existing: additionalDirectories,
          });
          if (!res.ok) {
            logger.log(chalk.yellow(`/add-dir: ${res.reason}`));
          } else if (res.alreadyPresent) {
            logger.log(chalk.dim(`Already a working root: ${res.dir}`));
          } else {
            additionalDirectories.push(res.dir);
            // Re-advertise the updated roots in the system prompt; keep the
            // active output-style body layered on top (same as /output-style).
            _replBaseSystem = _buildReplBaseSystem();
            messages[0].content = _activeOutputStyle
              ? `${_replBaseSystem}\n\n${_activeOutputStyle.body}`
              : _replBaseSystem;
            // The workspace root LIST changed — advertise it to connected MCP
            // servers and fire notifications/roots/list_changed so they re-query
            // roots/list (Claude-Code 2.1.203 parity, same as /cd but with an
            // explicit new root, not just a cwd-derived change).
            notifyMcpRootsChanged(
              [_adhocMcp?.mcpClient, _bundleMcpClient],
              workspaceRootDirs(process.cwd(), additionalDirectories),
            );
            logger.log(chalk.green(`Added working root: ${res.dir}`));
          }
        }
      } catch (err) {
        logger.error(chalk.red(`/add-dir failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/init [--force]` — inventory the current folder into a cc.md
    // project-memory file (Claude-Code /init parity). Non-interactive: reuses
    // the same offline census as `cc init`. Loaded as project context next
    // session (or inspect with /memory).
    if (trimmed === "/init" || trimmed.startsWith("/init ")) {
      const force = /(^|\s)(--force|-f)(\s|$)/.test(trimmed);
      try {
        const { inventoryProject, renderMemoryFile } =
          await import("../lib/project-inventory.js");
        const initCwd = process.cwd();
        const target = path.join(initCwd, "cc.md");
        if (fs.existsSync(target) && !force) {
          logger.log(
            chalk.yellow(
              `cc.md already exists at ${target} — /init --force to overwrite.`,
            ),
          );
        } else {
          const inv = inventoryProject(initCwd);
          fs.writeFileSync(target, renderMemoryFile(inv), "utf-8");
          logger.log(chalk.green(`Generated ${target}`));
          const langs = (inv.languages || [])
            .slice(0, 5)
            .map(([l, n]) => `${l} (${n})`)
            .join(", ");
          if (langs) logger.log(chalk.dim(`  Languages: ${langs}`));
          if (inv.packageManager)
            logger.log(chalk.dim(`  Package manager: ${inv.packageManager}`));
          if (inv.scripts && inv.scripts.length)
            logger.log(
              chalk.dim(`  Scripts documented: ${inv.scripts.length}`),
            );
          logger.log(
            chalk.dim(
              "  Loaded as project context next session (or /memory to inspect).",
            ),
          );
        }
      } catch (err) {
        logger.error(chalk.red(`/init failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/agents [list|show <name>|new <name> …]` — manage sub-agent DEFINITIONS
    // (.chainlesschain/agents/*.md / .claude/agents/*.md). Mirrors `cc agents`;
    // distinct from /sub-agents (running instances). Claude-Code /agents parity.
    if (trimmed === "/agents" || trimmed.startsWith("/agents ")) {
      try {
        const { parseAgentsCommand, formatAgentsList, formatAgentDetail } =
          await import("./agents-status.js");
        const { discoverAgents, getAgent, scaffoldAgent } =
          await import("../lib/agents.js");
        const { listSubAgentProfiles } =
          await import("../lib/sub-agent-profiles.js");
        const cmd = parseAgentsCommand(trimmed);
        if (cmd.action === "help") {
          logger.log(
            "Usage: /agents [list] · /agents show <name> · /agents new <name> [--tools a,b] [--claude|--personal] [--description <text>]",
          );
        } else if (cmd.action === "list") {
          logger.log(
            "\n" +
              formatAgentsList(
                discoverAgents(process.cwd()),
                listSubAgentProfiles(),
              ) +
              "\n",
          );
        } else if (cmd.action === "show") {
          if (!cmd.name) {
            logger.log(chalk.yellow("Usage: /agents show <name>"));
          } else {
            const a = getAgent(cmd.name, process.cwd());
            if (!a) logger.log(chalk.yellow(`No such agent: ${cmd.name}`));
            else logger.log("\n" + formatAgentDetail(a) + "\n");
          }
        } else if (cmd.action === "new") {
          if (!cmd.name) {
            logger.log(
              chalk.yellow("Usage: /agents new <name> [--description <text>]"),
            );
          } else {
            const res = scaffoldAgent({
              name: cmd.name,
              description: cmd.description,
              tools: cmd.tools,
              location: cmd.location,
            });
            if (!res.ok) {
              logger.log(chalk.yellow(`/agents new: ${res.reason}`));
            } else {
              logger.log(chalk.green(`✓ created ${res.file}`));
              logger.log(
                chalk.dim(
                  `  edit it, then spawn it from the agent or run: cc agents run ${res.name} "<task>"`,
                ),
              );
            }
          }
        }
      } catch (err) {
        logger.error(chalk.red(`/agents failed: ${err.message}`));
      }
      prompt();
      return;
    }

    if (trimmed === "/sub-agents" || trimmed === "/subagents") {
      try {
        const { SubAgentRegistry } =
          await import("../lib/sub-agent-registry.js");
        const registry = SubAgentRegistry.getInstance();
        const active = registry.getActive();
        const history = registry.getHistory();
        const stats = registry.getStats();

        logger.log(chalk.bold("\nSub-Agent Registry:"));
        logger.log(
          `  Active: ${chalk.yellow(active.length)}  Completed: ${chalk.green(stats.completed)}  Tokens: ${stats.totalTokens}  Avg Duration: ${stats.avgDurationMs}ms`,
        );

        if (active.length > 0) {
          logger.log(chalk.bold("\n  Active Sub-Agents:"));
          for (const a of active) {
            logger.log(
              `    ${chalk.cyan(a.id)} [${a.role}] ${a.task.substring(0, 50)} (iter: ${a.iterationCount})`,
            );
          }
        }

        if (history.length > 0) {
          logger.log(chalk.bold("\n  Recent History (last 10):"));
          for (const h of history.slice(-10)) {
            const status =
              h.status === "completed" ? chalk.green("✓") : chalk.red("✗");
            logger.log(
              `    ${status} ${chalk.dim(h.id)} [${h.role}] ${(h.summary || "").substring(0, 60)}`,
            );
          }
        }

        logger.log("");
      } catch (_err) {
        logger.log(chalk.dim("Sub-agent registry not available."));
      }
      prompt();
      return;
    }

    if (trimmed.startsWith("/model")) {
      const arg = trimmed.slice(6).trim();
      if (arg) {
        model = arg;
        _curModel = model; // keep the status-line readout in sync
        _modelPinned = true; // explicit choice — fast mode must not override it
        logger.info(`Model: ${chalk.cyan(model)}`);
        // Claude-Code 2.1.183 parity: warn when the newly-selected model is a
        // provider-retired/deprecated snapshot. Headless paths already warn via
        // maybeWarnDeprecatedModel; the interactive /model switch did not, so a
        // user could silently switch to a retired id and only learn of it when
        // the next turn fails with an opaque "model not found".
        try {
          const { maybeWarnDeprecatedModel } =
            await import("../lib/model-deprecation.js");
          maybeWarnDeprecatedModel({ model });
        } catch {
          // deprecation notice is best-effort
        }
      } else {
        logger.info(`Current model: ${chalk.cyan(model)}`);
      }
      prompt();
      return;
    }

    if (trimmed.startsWith("/provider")) {
      const arg = trimmed.slice(9).trim();
      if (arg) {
        const supported = [
          "ollama",
          "anthropic",
          "openai",
          "deepseek",
          "dashscope",
          "mistral",
          "gemini",
          "volcengine",
        ];
        if (supported.includes(arg)) {
          provider = arg;
          logger.info(`Provider: ${chalk.cyan(provider)}`);
        } else {
          logger.info(
            `Unsupported provider. Available: ${supported.join(", ")}`,
          );
        }
      } else {
        logger.info(`Current provider: ${chalk.cyan(provider)}`);
        logger.info(
          chalk.gray(
            "Available: ollama, anthropic, openai, deepseek, dashscope, mistral, gemini, volcengine",
          ),
        );
      }
      prompt();
      return;
    }

    // Extended-thinking toggle (Anthropic extended thinking; ignored by other
    // providers). Mutates `thinking`, read by the next turn's agentLoop call.
    {
      const think = parseThinkCommand(trimmed);
      if (think) {
        thinking = think.thinking;
        const note = think.anthropic
          ? " " + chalk.gray("(Anthropic only; applies next turn)")
          : "";
        logger.info(`Extended thinking: ${chalk.cyan(think.label)}${note}`);
        prompt();
        return;
      }
    }

    // Reasoning-effort alias (/effort low|medium|high|xhigh) — a discrete,
    // validated front-end over the /think <level> passthrough (Claude-Code parity).
    {
      const effort = parseEffortCommand(trimmed);
      if (effort) {
        if (effort.error) {
          logger.info(effort.error);
          prompt();
          return;
        }
        thinking = effort.thinking;
        logger.info(
          `Reasoning effort: ${chalk.cyan(effort.label)} ` +
            chalk.gray("(Anthropic extended thinking; applies next turn)"),
        );
        prompt();
        return;
      }
    }

    // `/btw` is an immediate, tool-free side question over a snapshot of the
    // current context. It never mutates or persists into the parent history.
    {
      const btw = parseBtwCommand(trimmed);
      if (btw) {
        await runBtwSideQuestion(btw);
        prompt();
        return;
      }
    }

    // `/advisor`: session-local enable/disable, one forced review, or status.
    // One-shot advice is queued as an ephemeral prepareCall suffix, requiring
    // the main agent to validate it locally on its next model/tool turn.
    {
      const { parseAdvisorCommand, executeAdvisorCommand } =
        await import("./advisor-command.js");
      const advisorCommand = parseAdvisorCommand(trimmed);
      if (advisorCommand) {
        const result = await executeAdvisorCommand(advisorCommand, {
          runtime: _advisorRuntime,
          messages,
          signal: _turnAbort?.signal || null,
        });
        if (result?.output) logger.log(result.output);
        if (result?.guidance) {
          _advisorRuntime?.queueGuidance(result.guidance);
        }
        prompt();
        return;
      }
    }

    // Preserve the previous next-turn guidance behavior under an honest name.
    {
      const note = parseNoteNextCommand(trimmed);
      if (note) {
        if (note.error) logger.info(note.error);
        else {
          pendingBtw.push(note.text);
          logger.info(
            chalk.gray(
              `Next-turn note queued (${pendingBtw.length}); it will not be saved to history.`,
            ),
          );
        }
        prompt();
        return;
      }
    }

    if (trimmed === "/clear") {
      // Stash the conversation first so `/rewind clear` can restore it
      // (Claude-Code 2.1.191). A no-op /clear (nothing to stash) keeps any
      // existing restorable snapshot.
      const { snapshotClearedConversation } =
        await import("../lib/repl-rewind.js");
      const snap = snapshotClearedConversation(messages, _checkpointMarks);
      if (snap) _clearedConversation = snap;
      messages.length = 1; // Keep system prompt
      _checkpointMarks.length = 0; // checkpoint marks no longer map to anything
      _promptInteractions.clearClipboardImageChips();
      logger.info(
        snap
          ? "Conversation cleared — run /rewind clear to restore it"
          : "Conversation cleared",
      );
      prompt();
      return;
    }

    if (
      trimmed === "/terminal-setup" ||
      trimmed.startsWith("/terminal-setup ")
    ) {
      try {
        const arg = trimmed.slice("/terminal-setup".length).trim();
        const { runTerminalSetup } =
          await import("../commands/terminal-setup.js");
        const res = runTerminalSetup({ apply: arg === "--apply" });
        for (const l of res.lines) logger.log(l);
      } catch (err) {
        logger.error(`/terminal-setup failed: ${err.message}`);
      }
      prompt();
      return;
    }

    // `/theme` — color theme (Claude-Code parity). `mono` strips all color;
    // `light` uses a blue prompt accent. Persisted to config `cli.theme`.
    if (trimmed === "/theme" || trimmed.startsWith("/theme ")) {
      const arg = trimmed.slice("/theme".length).trim();
      if (!arg) {
        logger.log("\n" + renderThemeList(_theme) + "\n");
        prompt();
        return;
      }
      const next = resolveTheme(arg);
      if (!next) {
        logger.error(
          chalk.red(
            `Unknown theme "${arg}". Available: ${listThemeNames().join(", ")}`,
          ),
        );
        prompt();
        return;
      }
      _theme = next;
      applyThemeChalk(_theme, chalk, _chalkBaselineLevel);
      try {
        const { setConfigValue } = await import("../lib/config-manager.js");
        setConfigValue("cli.theme", _theme);
      } catch (_e) {
        /* persistence is best-effort */
      }
      rl.setPrompt(getPrompt());
      logger.log(chalk.gray(`Theme set to ${_theme}.`));
      prompt();
      return;
    }

    // `/tui` — fullscreen no-flicker view (Claude-Code parity). `fullscreen`
    // enters the alternate screen buffer; `default` returns to streaming
    // scrollback. No arg prints the current mode. Persisted to `cli.tuiMode`.
    if (trimmed === "/tui" || trimmed.startsWith("/tui ")) {
      const arg = trimmed.slice("/tui".length).trim().toLowerCase();
      if (!arg) {
        logger.log(chalk.gray(_renderTuiStatus(_tuiMode)));
        prompt();
        return;
      }
      const next = _resolveTuiMode({ arg });
      if (arg !== "fullscreen" && arg !== "default") {
        logger.error(
          chalk.red(`Unknown TUI mode "${arg}". Use: fullscreen | default`),
        );
        prompt();
        return;
      }
      if (_screenReaderMode && next === "fullscreen") {
        logger.info(
          chalk.gray(
            "Screen-reader mode is on — staying in default (scrollback) view.",
          ),
        );
        prompt();
        return;
      }
      _setTuiMode(next);
      try {
        const { setConfigValue } = await import("../lib/config-manager.js");
        setConfigValue("cli.tuiMode", _tuiMode);
      } catch (_e) {
        /* persistence is best-effort */
      }
      logger.log(chalk.gray(_renderTuiStatus(_tuiMode)));
      prompt();
      return;
    }

    // `/fast` — latency profile (Claude-Code parity). on/off/status/toggle.
    // When on, the next turn minimizes reasoning and swaps to the provider's
    // low-latency model (unless a model is pinned). Persisted to cli.fastMode.
    {
      const fast = _parseFastCommand(trimmed);
      if (fast) {
        if (fast.error) {
          logger.error(chalk.red(fast.error));
          prompt();
          return;
        }
        if (fast.action === "status") {
          logger.log(
            chalk.gray(
              _renderFastStatus({ enabled: _fastMode, provider, model }),
            ),
          );
          prompt();
          return;
        }
        _fastMode =
          fast.action === "on"
            ? true
            : fast.action === "off"
              ? false
              : !_fastMode;
        try {
          const { setConfigValue } = await import("../lib/config-manager.js");
          setConfigValue("cli.fastMode", _fastMode);
        } catch (_e) {
          /* persistence is best-effort */
        }
        logger.log(
          chalk.gray(
            _renderFastStatus({ enabled: _fastMode, provider, model }),
          ),
        );
        prompt();
        return;
      }
    }

    // `/voice` — speech dictation (Claude-Code parity). hold=push-to-talk,
    // tap=toggle, off, status. Local-first STT; degrades on headless/SSH or
    // when no capture backend is configured (voice.backends / voice.allowCloud).
    {
      const voice = _parseVoiceCommand(trimmed);
      if (voice) {
        if (voice.error) {
          logger.error(chalk.red(voice.error));
          prompt();
          return;
        }
        const voiceEnv = _detectVoiceEnvironment({
          env: process.env,
          isTTY: Boolean(process.stdin.isTTY),
        });
        if (voice.action === "status") {
          const be = _resolveSttBackend(_voiceConfig).backend;
          logger.log(
            chalk.gray(
              _renderVoiceStatus({
                mode: _voiceMode,
                backend: be,
                env: voiceEnv,
              }),
            ),
          );
          prompt();
          return;
        }
        if (voice.action === "off") {
          _voiceMode = "off";
          logger.log(chalk.gray("Voice: off."));
          prompt();
          return;
        }
        // hold | tap — need a usable environment AND a resolvable backend.
        if (!voiceEnv.supported) {
          logger.info(chalk.yellow(`Voice unavailable — ${voiceEnv.reason}.`));
          prompt();
          return;
        }
        const { backend, reason } = _resolveSttBackend(_voiceConfig);
        if (!backend) {
          logger.info(chalk.yellow(`Voice: ${reason}`));
          prompt();
          return;
        }
        _voiceMode = voice.action;
        logger.log(
          chalk.gray(
            _renderVoiceStatus({
              mode: _voiceMode,
              backend,
              env: voiceEnv,
            }) + ` (${reason})`,
          ),
        );
        prompt();
        return;
      }
    }

    if (trimmed === "/vim" || trimmed.startsWith("/vim ")) {
      const arg = trimmed.slice("/vim".length).trim().toLowerCase();
      const turnOn = arg === "on" || (arg === "" && !_vimEnabled);
      if (turnOn) {
        _vimEnabled = true;
        logger.info(
          chalk.gray(
            "Vim mode: on — Esc → NORMAL (hjkl/w/b/e, x/dd/dw, i/a/A, etc.), i to insert.",
          ),
        );
      } else {
        _vimDisable();
        logger.info(chalk.gray("Vim mode: off"));
      }
      prompt();
      return;
    }

    if (trimmed === "/statusline" || trimmed.startsWith("/statusline ")) {
      const arg = trimmed.slice("/statusline".length).trim().toLowerCase();
      if (arg === "off") {
        _statusLineEnabled = false;
        logger.info("Status line: off");
      } else if (arg === "on") {
        _statusLineEnabled = true;
        logger.info("Status line: on");
      } else {
        // bare / "show" → report state + a one-off render
        const line =
          _statusLineEnabled && _renderStatus ? _renderStatus() : null;
        if (line) {
          logger.info(`Status line: ${_customStatus ? line : chalk.dim(line)}`);
        } else {
          logger.info(
            `Status line: ${_statusLineEnabled ? "on (no content yet)" : "off"}` +
              (_statusLineEnabled
                ? ""
                : ` — enable with ${chalk.cyan("/statusline on")}`),
          );
        }
        if (_customStatus) {
          logger.info(chalk.gray("  source: settings.json statusLine command"));
        }
      }
      prompt();
      return;
    }

    if (trimmed === "/output-style" || trimmed.startsWith("/output-style ")) {
      const arg = trimmed.slice("/output-style".length).trim();
      try {
        const { discoverOutputStyles, getOutputStyle } =
          await import("../lib/output-styles.js");
        if (!arg) {
          logger.log(chalk.bold("Output styles:"));
          for (const s of discoverOutputStyles(process.cwd())) {
            const cur =
              _activeOutputStyle?.name === s.name ? chalk.green(" *") : "";
            logger.log(
              `  ${s.name.padEnd(16)}${cur}  ${chalk.gray(s.description || "")}`,
            );
          }
          logger.log(
            chalk.gray(`current: ${_activeOutputStyle?.name || "none"}`),
          );
        } else if (arg === "none" || arg === "default") {
          _activeOutputStyle = null;
          messages[0].content = _replBaseSystem;
          logger.info("output style cleared");
        } else {
          const s = getOutputStyle(arg, process.cwd());
          if (!s) {
            logger.error(chalk.red(`no such output style: ${arg}`));
          } else {
            _activeOutputStyle = { name: s.name, body: s.body || "" };
            messages[0].content = s.body
              ? `${_replBaseSystem}\n\n${s.body}`
              : _replBaseSystem;
            logger.info(chalk.green(`output style → ${s.name}`));
          }
        }
      } catch (err) {
        logger.error(chalk.red(`/output-style failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/cd` (Claude-Code 2.1.163 parity): relocate the session's working
    // directory mid-conversation. Everything that reads process.cwd() per
    // call follows automatically (agent cwd, @-completion, project memory).
    if (trimmed === "/cd" || trimmed.startsWith("/cd ")) {
      const target = trimmed.slice(3).trim();
      if (!target) {
        logger.info(`cwd: ${process.cwd()}`);
      } else {
        try {
          const oldCwd = process.cwd();
          const expanded = target.replace(/^~(?=$|[\\/])/, os.homedir());
          process.chdir(path.resolve(process.cwd(), expanded));
          const newCwd = process.cwd();
          logger.log(chalk.green(`cwd → ${newCwd}`));
          // MCP roots derive from cwd — tell connected servers to re-query
          // roots/list (Claude-Code 2.1.203 change-notification parity).
          for (const c of [_adhocMcp?.mcpClient, _bundleMcpClient]) {
            if (c && typeof c.notifyRootsListChanged === "function") {
              try {
                c.notifyRootsListChanged();
              } catch {
                /* best-effort */
              }
            }
          }
          // CwdChanged settings hooks (lifecycle-event parity): the working dir
          // just changed, so fire CwdChanged with old→new cwd — a hook can
          // observe/react (re-audit the new dir's trust, reload per-dir config).
          // Observe-only (a cwd change never gates flow); best-effort; no-op
          // (byte-unchanged) without a registered CwdChanged hook.
          if (_settingsHooks && oldCwd !== newCwd) {
            try {
              const { runCwdChangedHooks, dispatchAsyncHooks } =
                await import("../lib/settings-hook-events.js");
              const payload = { oldCwd, newCwd, sessionId };
              runCwdChangedHooks(_settingsHooks, payload);
              if (!_asyncHookSupervisor) {
                const { AsyncHookSupervisor } =
                  await import("../lib/async-hook-supervisor.js");
                _asyncHookSupervisor = new AsyncHookSupervisor({
                  persistStats: true,
                });
              }
              dispatchAsyncHooks(
                _settingsHooks,
                "CwdChanged",
                {
                  old_cwd: oldCwd,
                  cwd: newCwd,
                  session_id: sessionId || null,
                },
                { cwd: newCwd, supervisor: _asyncHookSupervisor },
              );
            } catch {
              /* CwdChanged firing is best-effort */
            }
          }
        } catch (err) {
          logger.error(`/cd failed: ${err.message}`);
        }
      }
      prompt();
      return;
    }

    if (trimmed === "/rewind" || trimmed.startsWith("/rewind ")) {
      try {
        const {
          listUserTurns,
          rewindToTurn,
          renderTurnList,
          pickCheckpointForTurn,
          pruneMarksAfter,
          restoreClearedConversation,
          buildRewindPlan,
          renderRewindWarnings,
          buildBranchPlan,
          renderBranchPlan,
          parseRewindArg,
          pickPersistedTurn,
          RESTORE_SCOPE,
        } = await import("../lib/repl-rewind.js");
        const arg = trimmed.slice("/rewind".length).trim();
        // Parse the turn number + optional restore scope (--conversation /
        // --files / --both). Claude-Code parity: a rewind can restore the
        // conversation only, the files only, or both.
        const parsed = parseRewindArg(arg);
        // P1 turn/checkpoint binding: load the session's PERSISTED explicit
        // turn-binding table (headless runs of this session feed it). A
        // --resume'd session's pre-resume turns have no process-local marks —
        // the explicit table is the only source of their checkpoint ids and
        // side-effect coverage. Best-effort advisory: never blocks /rewind.
        let _persistedBinding = null;
        if (
          sessionId &&
          (parsed.command === "turn" || parsed.command === "branch")
        ) {
          try {
            const { loadTurnBindingLog } =
              await import("../lib/turn-binding-store.js");
            _persistedBinding = loadTurnBindingLog(sessionId);
          } catch {
            /* marks-only fallback */
          }
        }
        if (parsed.command === "clear") {
          // Restore the conversation stashed by /clear (Claude-Code 2.1.191).
          const r = restoreClearedConversation(
            messages,
            _checkpointMarks,
            _clearedConversation,
          );
          if (!r) {
            logger.error("Nothing to restore — no /clear has been run.");
          } else {
            _clearedConversation = r.newCleared;
            logger.log(
              chalk.green(
                `↺ restored ${r.restored} message(s) from before /clear` +
                  (r.stashed
                    ? ` (current ${r.stashed} stashed — /rewind clear swaps back)`
                    : ""),
              ),
            );
          }
          prompt();
          return;
        }
        if (parsed.command === "branch") {
          // "从这里分支" (P0-3's fourth restore action): fork a NEW independent
          // session that keeps history up to the chosen turn and diverges from
          // there. The origin session is NEVER truncated (preservesParent), so
          // the live conversation continues unchanged.
          const targetTurn = listUserTurns(messages, { limit: 1000 }).find(
            (t) => t.n === parsed.n,
          );
          if (!targetTurn) {
            logger.error(`No such turn: ${parsed.n} — run /rewind to list.`);
          } else if (!sessionId) {
            logger.error(
              "Branch needs a persisted session — none is active yet.",
            );
          } else {
            const turnIndex = targetTurn.index;
            const plan = buildBranchPlan(
              messages,
              _checkpointMarks,
              turnIndex,
              {
                parentSessionId: sessionId,
                writeIntent: parsed.writeIntent,
                persistedLog: _persistedBinding,
              },
            );
            if (!plan || !plan.branchSessionId) {
              logger.error("Could not plan a branch from that turn.");
            } else {
              try {
                const { createBranchSession } =
                  await import("../harness/jsonl-session-store.js");
                const res = createBranchSession({
                  branchSessionId: plan.branchSessionId,
                  parentSessionId: sessionId,
                  parentTurnId: plan.parentTurnId,
                  messages: messages.slice(0, turnIndex),
                  meta: { title: `Branch of ${sessionId}` },
                });
                logger.log(
                  chalk.green(
                    res.created
                      ? `🌿 branched to ${res.branchSessionId} — ${res.messages} message(s) kept; parent ${sessionId} untouched`
                      : `🌿 branch ${res.branchSessionId} already exists; parent ${sessionId} untouched`,
                  ),
                );
                for (const line of renderBranchPlan(plan))
                  logger.log(chalk.yellow(line));
                logger.log(
                  chalk.gray(
                    `  resume it with  cc agent --resume ${res.branchSessionId}` +
                      (plan.requiresWorktree
                        ? "  (write task → branch into an isolated worktree)"
                        : ""),
                  ),
                );
              } catch (e) {
                logger.error(`branch failed: ${e.message}`);
              }
            }
          }
          prompt();
          return;
        }
        if (parsed.command === "list") {
          logger.log(chalk.bold("\nRewind — pick a user turn (newest first):"));
          logger.log(renderTurnList(listUserTurns(messages)));
          const fileHint = _checkpointMarks.length
            ? "  (restores files to that point too — checkpoints are on)"
            : "  (conversation only — start with --checkpoint / git to also rewind files)";
          logger.log(chalk.gray(`Usage: /rewind <n>${fileHint}`));
          logger.log(
            chalk.gray(
              "  scope: /rewind <n> --conversation | --files | --both (default)",
            ),
          );
          logger.log(
            chalk.gray(
              "  branch: /rewind <n> --branch [--write] forks an independent session (parent kept)",
            ),
          );
          if (_clearedConversation) {
            logger.log(
              chalk.gray(
                `  /rewind clear — restore the ${_clearedConversation.messages.length} message(s) from before the last /clear`,
              ),
            );
          }
        } else {
          const scope = parsed.scope;
          const rewindConversation = scope !== RESTORE_SCOPE.FILES;
          const restoreFiles = scope !== RESTORE_SCOPE.CONVERSATION;
          // Snapshot + locate the target turn BEFORE any truncation:
          // buildRewindPlan needs the turn still present to bind its checkpoint,
          // and a files-only rewind keeps the conversation intact entirely.
          const preRewind = messages.slice();
          const targetTurn = listUserTurns(messages, { limit: 1000 }).find(
            (t) => t.n === parsed.n,
          );
          if (!targetTurn) {
            logger.error(`No such turn: ${parsed.n} — run /rewind to list.`);
          } else {
            const turnIndex = targetTurn.index;
            // 1) Conversation rewind (skipped for files-only).
            if (rewindConversation) {
              const res = rewindToTurn(messages, parsed.n);
              logger.log(
                chalk.yellow(
                  `⎌ rewound — dropped ${res.removed} message(s); edit and resend below`,
                ),
              );
            } else {
              logger.log(
                chalk.yellow("⎌ files-only rewind — conversation left intact"),
              );
            }
            // 2) Coverage-aware honesty for the CHOSEN scope (P1 turn/checkpoint
            // binding): print what a restore can and cannot promise — a shell/
            // external side-effect → PARTIAL, no checkpoint → files can't be
            // restored, and a scope-specific conversation/files drift. Derived
            // from the REPL's existing marks (no new agent-loop events);
            // best-effort so the advisory never blocks the rewind itself.
            try {
              const plan = buildRewindPlan(
                preRewind,
                _checkpointMarks,
                turnIndex,
                scope,
                { persistedLog: _persistedBinding },
              );
              for (const line of renderRewindWarnings(plan))
                logger.log(chalk.yellow(line));
            } catch {
              /* advisory only — a rewind must never fail over its own warning */
            }
            // 3) File restore (skipped for conversation-only). Match the turn to
            // the snapshot taken just before it first mutated the tree, then
            // offer to roll the working tree back to it (undoable — the restore
            // takes its own safety checkpoint first). Process-local marks win;
            // a --resume'd turn with no marks falls back to the checkpoint id
            // the PERSISTED binding table recorded for it (same checkpoint
            // store, so cross-process file rewind actually works — restore
            // still fails soft if the snapshot is gone). Prune dropped-turn
            // marks only when the conversation was actually truncated.
            let cp = restoreFiles
              ? pickCheckpointForTurn(_checkpointMarks, turnIndex)
              : null;
            if (!cp && restoreFiles) {
              const persisted = pickPersistedTurn(_persistedBinding, turnIndex);
              if (persisted?.fileCheckpointId) {
                cp = { id: persisted.fileCheckpointId, fromPersisted: true };
              }
            }
            if (rewindConversation)
              pruneMarksAfter(_checkpointMarks, turnIndex);
            if (cp) {
              const q = (p) => new Promise((r) => rl.question(p, r));
              const promptText = rewindConversation
                ? `  Also restore files to before this turn? (checkpoint ${cp.id}) [Y/n] `
                : `  Restore files to before this turn? (checkpoint ${cp.id}) [Y/n] `;
              const ans = (await q(chalk.yellow(promptText)))
                .trim()
                .toLowerCase();
              if (ans === "" || ans === "y" || ans === "yes") {
                try {
                  const { rewindTo } =
                    await import("../lib/checkpoint-store.js");
                  const r = rewindTo(process.cwd(), cp.id, {
                    session: sessionId,
                  });
                  logger.log(
                    chalk.green(
                      `  ⎌ files restored to ${cp.id} (${r.modified} changed, ${r.deleted} removed, ${r.recreated} recreated; undo: cc checkpoint restore ${r.safetyId})`,
                    ),
                  );
                } catch (e) {
                  logger.error(
                    `  file restore skipped: ${e.message}${rewindConversation ? " (conversation already rewound)" : ""}`,
                  );
                }
              } else {
                logger.log(
                  chalk.gray(
                    `  files left as-is — restore later with  cc checkpoint restore ${cp.id}`,
                  ),
                );
              }
            } else if (restoreFiles && scope === RESTORE_SCOPE.FILES) {
              logger.log(
                chalk.gray(
                  "  no checkpoint captured for that turn — nothing to restore",
                ),
              );
            }
            prompt();
            // Prefill the input line with the turn's text only when the
            // conversation was rewound (edit-and-resend); files-only leaves the
            // conversation and the prompt untouched.
            if (rewindConversation && typeof targetTurn.content === "string")
              rl.write(targetTurn.content);
            return;
          }
        }
      } catch (err) {
        logger.error(`/rewind failed: ${err.message}`);
      }
      prompt();
      return;
    }

    if (trimmed === "/context") {
      // Live-session twin of `cc context` (Claude-Code /context parity):
      // bucket the CURRENT in-memory conversation by role against the model
      // window. Reuses the same categorizer + estimator as the archived view.
      try {
        const { categorizeContext } = await import("../commands/context.js");
        const { estimateTokens } =
          await import("../harness/prompt-compressor.js");
        const { buckets, counts, total } = categorizeContext(
          messages,
          estimateTokens,
        );
        const window = getContextWindow(model, provider) || 0;
        logger.log(chalk.bold("\nContext usage (live session):"));
        const rows = [
          ["system", buckets.system, counts.system],
          ["user", buckets.user, counts.user],
          ["assistant", buckets.assistant, counts.assistant],
          ["tool", buckets.tool, counts.tool],
          ["tool_calls", buckets.toolCalls, null],
        ];
        for (const [label, tok, n] of rows) {
          if (!tok) continue;
          const share = total ? Math.round((tok / total) * 100) : 0;
          logger.log(
            `  ${label.padEnd(11)}${String(tok).padStart(9)} tok ${String(share).padStart(3)}%${
              n != null ? chalk.gray(`  (${n} msgs)`) : ""
            }`,
          );
        }
        const pct = window ? Math.round((total / window) * 100) : null;
        logger.log(
          `  ${"total".padEnd(11)}${String(total).padStart(9)} tok${
            window
              ? `  ${pct}% of ${window} (${Math.max(0, window - total)} left)`
              : ""
          }`,
        );
        // MCP tool-schema share of the window (gap-analysis 第二阶段 item 3):
        // the tools parameter rides along on EVERY request but isn't part of
        // `messages`, so it's invisible to the role buckets above. Show the
        // per-server schema cost + tool-search state + optimization advice.
        if (_adhocMcp?.extraToolDefinitions?.length) {
          const { describeMcpToolContext } =
            await import("../runtime/mcp-tool-search.js");
          const info = describeMcpToolContext(_adhocMcp, {
            estimate: estimateTokens,
            model,
            provider,
          });
          if (info) {
            const ts = info.toolSearch;
            logger.log(chalk.bold("\nMCP tool schemas (sent every request):"));
            for (const row of info.servers) {
              const share = window
                ? Math.round((row.sentTokens / window) * 100)
                : 0;
              logger.log(
                `  ${row.server.padEnd(16)}${String(row.sentTokens).padStart(7)} tok ${String(share).padStart(3)}%` +
                  chalk.gray(
                    `  (${row.tools} tools${
                      row.deferred ? `, ${row.deferred} deferred` : ""
                    })`,
                  ),
              );
            }
            logger.log(
              `  ${"total".padEnd(16)}${String(info.sentTokens).padStart(7)} tok` +
                (ts.active
                  ? chalk.gray(
                      `  (tool search: ${ts.deferredCount} deferred, ` +
                        `${ts.loadedCount} loaded, ~${info.savedTokens} tok saved)`,
                    )
                  : ""),
            );
            for (const line of info.advice) {
              logger.log(chalk.yellow(`  ⚠ ${line}`));
            }
          }
        }
      } catch (err) {
        logger.error(`/context failed: ${err.message}`);
      }
      prompt();
      return;
    }

    if (trimmed === "/compact") {
      if (_compactionUsageBlock) {
        logger.error(
          `Compaction blocked (${_compactionUsageBlock.code}): ${_compactionUsageBlock.reason}`,
        );
        prompt();
        return;
      }

      const expectedMessages = [...messages];
      if (_compressor && messages.length > 3) {
        let result;
        try {
          result = await compactConversationWithProvider(messages, {
            compressor: _compressor,
            preserveCompletedExchange: true,
            ..._compactOpts(messages),
          });
        } catch (error) {
          if (
            isAbortError(error) ||
            _sessionHostLeaseScope?.lease?.signal?.aborted
          ) {
            throw error;
          }
          const terminalError = _runtimeLedgerTerminalLatch.trip(error);
          if (terminalError) {
            _reportRuntimeLedgerTerminal();
            prompt();
            return;
          }
          logger.error(`Compaction failed: ${error.message}`);
          prompt();
          return;
        }
        const {
          messages: compacted,
          stats,
          usageEvent,
          usageUnknownEvent,
        } = result;
        const settlement = settleReplCompactionCandidate({
          messages,
          expectedMessages,
          compacted,
          stats,
          trigger: "manual",
          useJsonl,
          sessionId,
          persistence: _replCompactPersistence,
          usageEvent,
          usageUnknownEvent,
          costStore: _costStore,
        });
        if (settlement.usagePersistenceError) {
          const terminalError = _runtimeLedgerTerminalLatch.trip(
            settlement.usagePersistenceError,
          );
          if (terminalError) {
            _reportRuntimeLedgerTerminal();
            prompt();
            return;
          }
        }
        if (settlement.block) {
          _compactionUsageBlock = settlement.block;
          logger.error(
            `Compaction usage is unknown (${settlement.block.code}); the paid compaction will not be retried.`,
          );
          prompt();
          return;
        }
        if (!settlement.applied) {
          logger.warn(
            `Compaction was not applied: ${settlement.error?.message || "canonical settlement failed"}`,
          );
          prompt();
          return;
        }
        recordCompressionMetric(stats, {
          source: "manual-compact",
          provider,
          model,
        });
        logger.info(
          `Compacted: ${stats.originalMessages} → ${stats.compressedMessages} messages, saved ${stats.saved} tokens (${stats.strategy})`,
        );
        if (stats.degraded === true) {
          logger.warn(
            `Semantic compaction degraded to ${stats.summaryMode}: ${stats.degradedReason}`,
          );
        }
      } else if (contextEngine && messages.length > 5) {
        const compacted = contextEngine.smartCompact(messages);
        const originalTokens = estimateMessagesTokens(messages);
        const compressedTokens = estimateMessagesTokens(compacted);
        const settlement = settleReplCompactionCandidate({
          messages,
          expectedMessages,
          compacted,
          stats: {
            strategy: "importance",
            originalMessages: messages.length,
            compressedMessages: compacted.length,
            originalTokens,
            compressedTokens,
            saved: originalTokens - compressedTokens,
            ratio: originalTokens > 0 ? compressedTokens / originalTokens : 1,
          },
          trigger: "manual",
          useJsonl,
          sessionId,
          persistence: _replCompactPersistence,
          costStore: _costStore,
        });
        if (settlement.applied) {
          logger.info(
            `Compacted to ${messages.length} messages (importance-based)`,
          );
        } else {
          logger.warn(
            `Compaction was not applied: ${settlement.error?.message || "canonical settlement failed"}`,
          );
        }
      } else if (messages.length > 5) {
        const systemMsg = messages[0];
        const recent = messages.slice(-4);
        const compacted = [systemMsg, ...recent];
        const originalTokens = estimateMessagesTokens(messages);
        const compressedTokens = estimateMessagesTokens(compacted);
        const settlement = settleReplCompactionCandidate({
          messages,
          expectedMessages,
          compacted,
          stats: {
            strategy: "truncate",
            originalMessages: messages.length,
            compressedMessages: compacted.length,
            originalTokens,
            compressedTokens,
            saved: originalTokens - compressedTokens,
            ratio: originalTokens > 0 ? compressedTokens / originalTokens : 1,
          },
          trigger: "manual",
          useJsonl,
          sessionId,
          persistence: _replCompactPersistence,
          costStore: _costStore,
        });
        if (settlement.applied) logger.info("Compacted to last 4 messages");
        else {
          logger.warn(
            `Compaction was not applied: ${settlement.error?.message || "canonical settlement failed"}`,
          );
        }
      }
      prompt();
      return;
    }

    // Micro-compaction: surgically trim large OLD tool results in place (keeps
    // recent messages + the conversation flow). Safe (never orphans a tool
    // pair); cheaper + less lossy than a full /compact.
    if (trimmed === "/microcompact") {
      const { microCompact } = await import("../lib/micro-compact.js");
      const { messages: mc, stats } = microCompact(messages);
      if (stats.trimmed > 0) {
        const settlement = settleReplCompactionCandidate({
          messages,
          expectedMessages: [...messages],
          compacted: mc,
          stats: {
            ...stats,
            strategy: "microcompact",
            originalMessages: messages.length,
            compressedMessages: mc.length,
          },
          trigger: "manual",
          useJsonl,
          sessionId,
          persistence: _replCompactPersistence,
        });
        if (settlement.applied) {
          logger.info(
            `Micro-compacted: trimmed ${stats.trimmed} old tool result(s), ~${stats.saved} chars freed (recent messages kept).`,
          );
        } else {
          logger.warn(
            `Micro-compaction was not applied: ${settlement.error?.message || "canonical settlement failed"}`,
          );
        }
      } else {
        logger.info(
          "Nothing to micro-compact — no large old tool results in context.",
        );
      }
      prompt();
      return;
    }

    // Task commands
    if (trimmed.startsWith("/task")) {
      const taskArg = trimmed.slice(5).trim();
      if (taskArg === "clear") {
        contextEngine.clearTask();
        logger.info("Task cleared");
      } else if (taskArg) {
        contextEngine.setTask(taskArg);
        logger.info(`Task set: ${chalk.cyan(taskArg)}`);
      } else {
        if (contextEngine.taskContext) {
          logger.info(
            `Current task: ${chalk.cyan(contextEngine.taskContext.objective)}`,
          );
        } else {
          logger.info("No task set. Usage: /task <objective>");
        }
      }
      prompt();
      return;
    }

    // Session info
    if (trimmed === "/session" || trimmed.startsWith("/session ")) {
      const sessionArg = trimmed.slice(8).trim();
      if (sessionArg.startsWith("resume ")) {
        const resumeId = sessionArg.slice(7).trim();
        try {
          if (_sessionBudget && resumeId !== sessionId) {
            throw Object.assign(
              new Error(
                "a budgeted REPL is bound to its startup session; exit and restart to resume another session",
              ),
              { code: "CC_SESSION_BUDGET_REPL_SWITCH_UNSUPPORTED" },
            );
          }
          if (useJsonl) {
            const initialCandidate = _prepareJsonlResumeCandidate(resumeId);
            if (!initialCandidate.ok) throw initialCandidate.error;
            const currentLease = _sessionHostLeaseScope?.lease || null;
            const reuseCurrentLease = initialCandidate.sessionId === sessionId;
            let targetLease = reuseCurrentLease ? currentLease : null;
            let adoptedTargetLease = reuseCurrentLease && Boolean(currentLease);
            if (!targetLease) {
              targetLease = acquireSessionHostLease(
                initialCandidate.sessionId,
                {
                  hostKind: "repl",
                },
              );
            }
            let prepared;
            try {
              // Re-sample after acquiring the target's write authority. The
              // first sample resolves/refuses the request; this one is the
              // exact snapshot committed into the live REPL.
              prepared = _prepareJsonlResumeCandidate(
                initialCandidate.sessionId,
              );
              if (!prepared.ok) throw prepared.error;
              const preparedSideEffects = _prepareReplSideEffects(
                prepared.sessionId,
                { recover: true },
              );
              const preparedMcpRuntime = _prepareMcpHostRuntime(
                prepared.sessionId,
                prepared.mcp,
              );
              const preparedMcpCommit = _prepareMcpRecoveryCommit(prepared.mcp);
              const hostSystemMessages = _refreshHostSystemMessages();
              const previousState = _captureResumeState();
              const preparedState = Object.freeze({
                sessionId: prepared.sessionId,
                hostSystemMessages,
                canonicalSystemMessages: Object.freeze([
                  ...prepared.canonicalSystemMessages,
                  ...(preparedSideEffects.noticeMessage
                    ? [preparedSideEffects.noticeMessage]
                    : []),
                ]),
                conversationMessages: prepared.conversationMessages,
                mcpCommit: preparedMcpCommit,
                mcpRuntime: preparedMcpRuntime,
                sanitizeRolesNextTurn:
                  prepared.conversationMessages.at(-1)?.role === "user",
                logMessage: `Resumed JSONL session ${prepared.sessionId} (${prepared.rebuiltMessages.length} messages)`,
              });
              const committed = commitPreparedReplJsonlResume(
                prepared,
                () => _applyPreparedResumeState(preparedState),
                () => _restoreResumeState(previousState),
              );
              if (!committed) {
                const error = new Error(
                  "Prepared JSONL session resume was not committed",
                );
                error.code = "CC_REPL_SESSION_RESUME_NOT_COMMITTED";
                throw error;
              }
              const previousLease = _replaceSessionHostLease(targetLease);
              adoptedTargetLease = true;
              _replSideEffects = preparedSideEffects.sideEffects;
              if (preparedSideEffects.warning) {
                logger.warn(preparedSideEffects.warning);
              }
              if (previousLease && previousLease !== targetLease) {
                try {
                  previousLease.release?.();
                } catch (releaseError) {
                  logger.warn(
                    `Session switch committed, but the prior host lease could not be released: ${releaseError.message}`,
                  );
                }
              }
              _replCompactPersistence.replace(prepared.rebuiltMessages);
            } finally {
              if (!adoptedTargetLease) targetLease?.release?.();
            }
          } else if (db) {
            const existing = getSession(db, resumeId);
            if (existing && existing.messages) {
              const parsed =
                typeof existing.messages === "string"
                  ? JSON.parse(existing.messages)
                  : existing.messages;
              const rebuiltMessages = snapshotReplMessages(parsed);
              const replayMessages = Object.freeze(
                rebuiltMessages.filter((message) => message.role !== "system"),
              );
              const preparedMcpRuntime = _prepareMcpHostRuntime(existing.id, {
                recovery: null,
                recoveryError: null,
              });
              const hostSystemMessages = _refreshHostSystemMessages();
              const previousState = _captureResumeState();
              const preparedState = Object.freeze({
                sessionId: existing.id,
                hostSystemMessages,
                canonicalSystemMessages: Object.freeze([]),
                conversationMessages: replayMessages,
                mcpCommit: Object.freeze({
                  recovery: null,
                  recoveryError: null,
                  noticeMessage: null,
                  warning: null,
                }),
                mcpRuntime: preparedMcpRuntime,
                sanitizeRolesNextTurn: replayMessages.at(-1)?.role === "user",
                logMessage: `Resumed session ${existing.id} (${rebuiltMessages.length} messages)`,
              });
              commitPreparedReplDbResume(
                preparedState,
                () => _applyPreparedResumeState(preparedState),
                () => _restoreResumeState(previousState),
              );
            } else {
              logger.info(`Session not found: ${resumeId}`);
            }
          } else {
            logger.info("No session store available");
          }
        } catch (err) {
          logger.error(
            JSON.stringify({
              type: "session.resume.refused",
              code: err?.code || "CC_REPL_SESSION_RESUME_FAILED",
              sessionId: resumeId,
              message: err?.message || "Session resume failed",
            }),
          );
        }
      } else {
        logger.info(`Session ID: ${sessionId || "none"}`);
        logger.info(`Messages: ${messages.length}`);
        logger.info(`DB: ${db ? "connected" : "not available"}`);
      }
      prompt();
      return;
    }

    // Reindex notes
    // `/reload-skills` (Claude-Code 2.1.152 parity): re-scan the 6 skill
    // layers (incl. .claude/skills) without restarting the session.
    if (trimmed === "/reload-skills") {
      try {
        _replSkillLoader.revokeExecutionAuthorizations?.({
          message:
            "Skill execution authorization was revoked by /reload-skills",
          reasonCode: "reload-skills",
        });
        _replSkillLoader.clearCache();
        const n = _replSkillLoader.loadAll().length;
        _replBaseSystem = _buildReplBaseSystem();
        messages[0].content = _activeOutputStyle
          ? `${_replBaseSystem}\n\n${_activeOutputStyle.body}`
          : _replBaseSystem;
        _persistReplContextSources();
        logger.log(
          chalk.green(
            `✔ Skill grants revoked and skills reloaded — ${n} available (${_replSkillLoader.getLayerPaths().length} layers re-scanned)`,
          ),
        );
      } catch (err) {
        logger.error(`/reload-skills failed: ${err.message}`);
      }
      prompt();
      return;
    }

    // `/reload-plugins` (Phase 3.3m): re-scan installed plugins after an
    // install / trust / upgrade WITHOUT restarting — resets memoized LSP
    // registration + managed-policy/trust caches, re-merges the effective hook
    // map, and restarts the monitor supervisor with the fresh set. Already-
    // connected MCP servers stay for this session (new ones load next session).
    if (trimmed === "/reload-plugins") {
      try {
        const cwd = process.cwd();
        const { reloadPluginRuntime } =
          await import("../lib/plugin-runtime/reload.js");
        const sum = reloadPluginRuntime({ cwd });

        // Re-merge plugin hooks onto the user's settings hooks (live session).
        try {
          const { loadHooks, attachAuthorityErrors } =
            await import("../lib/settings-hooks.cjs");
          const { mergePluginHooks } =
            await import("../lib/plugin-runtime/hooks.js");
          const loaded = loadHooks({ cwd });
          const merged = mergePluginHooks(
            attachAuthorityErrors(loaded.hooks, loaded.authorityErrors),
            { cwd },
          );
          _settingsHooks =
            Object.keys(merged).length > 0 || merged._authorityErrors.length > 0
              ? merged
              : null;
        } catch (error) {
          _settingsHooks = {};
          Object.defineProperty(_settingsHooks, "_authorityErrors", {
            value: Object.freeze([
              Object.freeze({
                sourceFile: null,
                code: error?.code || "CC_HOOK_AUTHORITY_LOAD_FAILED",
              }),
            ]),
            enumerable: false,
          });
        }

        // settings.json ConfigChange hooks (Claude-Code parity): the live
        // hooks / permissions / trusted-plugin set just changed, so fire
        // ConfigChange with the FRESH hook set — a policy hook can observe or
        // react (e.g. re-audit the newly-trusted config). Best-effort.
        if (_settingsHooks) {
          try {
            const { runObserveHooks, dispatchAsyncHooks } =
              await import("../lib/settings-hook-events.js");
            const payload = {
              session_id: sessionId || null,
              source: "reload-plugins",
            };
            runObserveHooks(_settingsHooks, "ConfigChange", payload, { cwd });
            if (!_asyncHookSupervisor) {
              const { AsyncHookSupervisor } =
                await import("../lib/async-hook-supervisor.js");
              _asyncHookSupervisor = new AsyncHookSupervisor({
                persistStats: true,
              });
            }
            dispatchAsyncHooks(_settingsHooks, "ConfigChange", payload, {
              cwd,
              supervisor: _asyncHookSupervisor,
            });
          } catch {
            /* ConfigChange hooks are best-effort */
          }
        }

        // Restart background monitors with the fresh, trust-gated set.
        try {
          const { collectPluginMonitors } =
            await import("../lib/plugin-runtime/monitors.js");
          if (_pluginMonitors) {
            _pluginMonitors.stopAll();
            _pluginMonitors = null;
          }
          const monitors = collectPluginMonitors({ cwd });
          if (monitors.length > 0) {
            const { PluginMonitorSupervisor } =
              await import("../lib/plugin-monitor-supervisor.js");
            _pluginMonitors = new PluginMonitorSupervisor();
            _pluginMonitors.start(monitors);
          }
        } catch {
          /* monitor restart is best-effort */
        }

        // Re-apply legacy plugin bin PATH; strict bins remain direct-only.
        try {
          const { applyPluginBinPath } =
            await import("../lib/plugin-runtime/bin.js");
          if (_pluginBinRestore) _pluginBinRestore();
          const res = applyPluginBinPath({ cwd });
          _pluginBinRestore = res.restore;
        } catch {
          /* bin re-apply is best-effort */
        }

        // Re-apply plugin default env vars (a newly-trusted plugin's settings).
        try {
          const { applyPluginSettingsEnv } =
            await import("../lib/plugin-runtime/settings.js");
          if (_pluginSettingsRestore) _pluginSettingsRestore();
          const res = applyPluginSettingsEnv({ cwd });
          _pluginSettingsRestore = res.restore;
        } catch {
          /* settings re-apply is best-effort */
        }

        logger.log(
          chalk.green(
            `✔ plugins reloaded — ${sum.plugins} plugin(s): ` +
              `${sum.skills} skill layer(s), ${sum.agents} agent dir(s), ` +
              `${sum.lspRegistered} LSP server(s), ${sum.hooks} hook event(s), ` +
              `${sum.mcp} MCP server(s), ${sum.monitors} monitor(s)`,
          ),
        );
        logger.log(
          chalk.gray("  (newly-added MCP servers connect on the next session)"),
        );
      } catch (err) {
        logger.error(`/reload-plugins failed: ${err.message}`);
      }
      prompt();
      return;
    }

    // `/review` — diff-first code review of your changes (Claude-Code
    // /code-review parity). Reuses the `cc review` machinery: collects the git
    // diff and runs ONE focused agent turn. Read-only by default; `--fix`
    // applies reversible (auto-checkpointed) edits. Runs against the current
    // cwd so it follows `/cd`, using this session's provider/model.
    if (trimmed === "/review" || trimmed.startsWith("/review ")) {
      const rest = trimmed.slice("/review".length).trim();
      const { parseReviewReplArgs, describeReviewArgs } =
        await import("./review-args.js");
      const { opts: reviewOpts, errors } = parseReviewReplArgs(rest);
      if (errors.length) {
        for (const e of errors) logger.error(chalk.red(`/review: ${e}`));
        logger.log(
          chalk.gray(
            "Usage: /review [low|medium|high] [--security|--simplify] " +
              "[--fix] [--staged|--base <ref>|--range <A..B>]",
          ),
        );
        prompt();
        return;
      }
      try {
        const { runReview } = await import("../commands/review.js");
        logger.info(chalk.gray(`Reviewing ${describeReviewArgs(reviewOpts)}`));
        const result = await runReview(
          {
            ...reviewOpts,
            provider,
            model,
            cwd: process.cwd(),
            outputFormat: "text",
          },
          {},
        );
        if (result && result.empty) {
          logger.log(chalk.gray("No changes to review."));
        }
      } catch (err) {
        logger.error(chalk.red(`/review failed: ${err.message}`));
      }
      prompt();
      return;
    }

    if (trimmed === "/reindex") {
      if (contextEngine) {
        contextEngine.reindexNotes();
        const stats = contextEngine.getStats();
        logger.info(`Notes reindexed: ${stats.notesIndexed} documents`);
      } else {
        logger.info("Context engine not available");
      }
      prompt();
      return;
    }

    // Stats
    if (trimmed === "/goal" || trimmed.startsWith("/goal ")) {
      // Session completion condition (distinct from `cc goal` OKR): set / show /
      // clear a condition that is evaluated + reported after each turn.
      try {
        const rg = await import("../lib/repl-goal.js");
        const cmd = rg.parseGoalCommand(trimmed.slice("/goal".length));
        if (cmd.action === "clear") {
          if (_sessionGoal) {
            _sessionGoal = null;
            logger.log(chalk.gray("◎ session goal cleared."));
          } else {
            logger.log(chalk.gray("No session goal to clear."));
          }
        } else if (cmd.action === "status") {
          for (const l of rg.renderGoalStatus(_sessionGoal))
            logger.log(chalk.gray(l));
        } else {
          // set — createReplGoal throws on a malformed spec (caught below).
          _sessionGoal = rg.createReplGoal(cmd.spec, {
            now: () => Date.now(),
          });
          for (const l of rg.renderGoalStart(_sessionGoal))
            logger.log(chalk.cyan(l));
        }
      } catch (err) {
        logger.error(`/goal: ${err.message}`);
      }
      prompt();
      return;
    }

    if (trimmed === "/stats") {
      if (contextEngine) {
        const stats = contextEngine.getStats();
        logger.info(`DB connected: ${stats.hasDb}`);
        logger.info(`Notes indexed: ${stats.notesIndexed}`);
        logger.info(`Error history: ${stats.errorCount}`);
        logger.info(`Active task: ${stats.hasTask}`);
      } else {
        logger.info("Context engine not available");
      }
      prompt();
      return;
    }

    // Session search
    if (trimmed.startsWith("/search")) {
      const searchQuery = trimmed.slice(7).trim();
      if (!searchQuery) {
        logger.info("Usage: /search <query>");
        prompt();
        return;
      }
      if (!db) {
        logger.info("Database not available for session search");
        prompt();
        return;
      }
      try {
        const { SessionSearchIndex } = await import("../lib/session-search.js");
        const index = new SessionSearchIndex(db);
        index.ensureTables();
        const results = index.search(searchQuery, { limit: 10 });
        if (results.length === 0) {
          logger.info(
            "No results found. Try /search after a few sessions, or run reindex.",
          );
        } else {
          logger.log(chalk.bold(`\nSearch results for "${searchQuery}":\n`));
          for (const r of results) {
            const snippet = (r.snippet || "").substring(0, 120);
            logger.log(
              `  ${chalk.cyan(r.sessionId.substring(0, 20))} [${chalk.dim(r.role)}] ${snippet}`,
            );
          }
          logger.log("");
        }
      } catch (err) {
        logger.error(`Search failed: ${err.message}`);
      }
      prompt();
      return;
    }

    // User profile commands
    if (trimmed.startsWith("/profile")) {
      const profileArg = trimmed.slice(8).trim();
      try {
        const { readUserProfile, updateUserProfile, getUserProfilePath } =
          await import("../lib/user-profile.js");

        if (!profileArg || profileArg === "show") {
          const content = readUserProfile();
          if (content) {
            logger.log(chalk.bold("\nUser Profile (USER.md):\n"));
            logger.log(content);
            logger.log(chalk.dim(`\nPath: ${getUserProfilePath()}`));
            logger.log("");
          } else {
            logger.info(
              `No user profile yet. Use /profile set <content> or let the agent learn your preferences.`,
            );
          }
        } else if (profileArg.startsWith("set ")) {
          const newContent = profileArg.slice(4).trim();
          if (!newContent) {
            logger.info("Usage: /profile set <content>");
          } else {
            const result = updateUserProfile(newContent);
            if (result.written) {
              logger.info(
                `Profile updated (${result.length} chars${result.truncated ? ", truncated" : ""})`,
              );
            } else {
              logger.error("Failed to write profile");
            }
          }
        } else if (profileArg === "clear") {
          updateUserProfile("");
          logger.info("Profile cleared.");
        } else if (profileArg === "path") {
          logger.info(`Profile path: ${getUserProfilePath()}`);
        } else {
          logger.log(chalk.bold("\nProfile Commands:"));
          logger.log(`  ${chalk.cyan("/profile")}          Show user profile`);
          logger.log(
            `  ${chalk.cyan("/profile set <content>")} Update profile`,
          );
          logger.log(`  ${chalk.cyan("/profile clear")}    Clear profile`);
          logger.log(`  ${chalk.cyan("/profile path")}     Show file path`);
          logger.log("");
        }
      } catch (err) {
        logger.error(`Profile command failed: ${err.message}`);
      }
      prompt();
      return;
    }

    // Cowork commands
    if (trimmed.startsWith("/cowork")) {
      const coworkArgs = trimmed.slice(7).trim();
      const [subCmd, ...rest] = coworkArgs.split(/\s+/);
      const coworkInput = rest.join(" ");

      if (!subCmd || subCmd === "help") {
        logger.log(chalk.bold("\nCowork Commands:"));
        logger.log(
          `  ${chalk.cyan("/cowork debate <file>")}      Multi-perspective code review`,
        );
        logger.log(
          `  ${chalk.cyan("/cowork compare <prompt>")}   A/B solution comparison`,
        );
        logger.log(
          `  ${chalk.cyan("/cowork graph <path>")}       Code knowledge graph (ASCII)`,
        );
        logger.log(
          `  ${chalk.cyan("/cowork decision <topic>")}   Architecture decision tracking`,
        );
        logger.log("");
      } else if (subCmd === "debate" && coworkInput) {
        try {
          const { startDebate } =
            await import("../lib/cowork/debate-review-cli.js");
          let code = coworkInput;
          let targetLabel = coworkInput;
          const resolved = path.resolve(coworkInput);
          if (fs.existsSync(resolved)) {
            code = fs.readFileSync(resolved, "utf-8");
            targetLabel = resolved;
            if (code.length > 15000) {
              code = code.substring(0, 15000) + "\n... (truncated)";
            }
          }
          process.stdout.write(chalk.gray("\n  Running debate review...\n"));
          const result = await startDebate({
            target: targetLabel,
            code,
            llmOptions: {
              provider,
              model,
              baseUrl,
              apiKey,
              callWrapper: _directChatCallWrapper,
            },
          });
          for (const review of result.reviews) {
            const vc =
              review.verdict === "APPROVE"
                ? chalk.green
                : review.verdict === "REJECT"
                  ? chalk.red
                  : chalk.yellow;
            process.stdout.write(
              `  ${chalk.bold(review.role)}: ${vc(review.verdict)}\n`,
            );
          }
          process.stdout.write(
            `\n  ${chalk.bold("Verdict:")} ${result.verdict}  Consensus: ${result.consensusScore}%\n\n`,
          );
          // Add summary to conversation for context
          messages.push({
            role: "assistant",
            content: `[Cowork Debate Result] ${result.verdict} (consensus: ${result.consensusScore}%)\n${result.summary.substring(0, 500)}`,
          });
        } catch (err) {
          const terminalError = _runtimeLedgerTerminalLatch.trip(err);
          if (terminalError) _reportRuntimeLedgerTerminal();
          else logger.error(`Debate failed: ${err.message}`);
        }
      } else if (subCmd === "compare" && coworkInput) {
        try {
          const { compare } =
            await import("../lib/cowork/ab-comparator-cli.js");
          process.stdout.write(chalk.gray("\n  Generating variants...\n"));
          const result = await compare({
            prompt: coworkInput,
            llmOptions: {
              provider,
              model,
              baseUrl,
              apiKey,
              callWrapper: _directChatCallWrapper,
            },
          });
          for (const v of result.variants) {
            process.stdout.write(
              `  ${chalk.cyan(v.name)}: score ${v.totalScore}\n`,
            );
          }
          process.stdout.write(
            `\n  ${chalk.bold("Winner:")} ${chalk.green(result.winner)}\n\n`,
          );
          messages.push({
            role: "assistant",
            content: `[Cowork Compare Result] Winner: ${result.winner}. ${result.reason}`,
          });
        } catch (err) {
          const terminalError = _runtimeLedgerTerminalLatch.trip(err);
          if (terminalError) _reportRuntimeLedgerTerminal();
          else logger.error(`Compare failed: ${err.message}`);
        }
      } else if (subCmd === "graph" && coworkInput) {
        try {
          const { analyzeCodeKnowledgeGraph } =
            await import("../lib/cowork/code-knowledge-graph-cli.js");
          process.stdout.write(chalk.gray("\n  Analyzing code graph...\n"));
          const result = await analyzeCodeKnowledgeGraph({
            target: coworkInput,
            llmOptions: { provider, model, baseUrl, apiKey },
          });
          // ASCII dependency graph
          if (result.entities && result.entities.length > 0) {
            process.stdout.write(chalk.bold("  Code Knowledge Graph:\n"));
            for (const entity of result.entities.slice(0, 15)) {
              const deps = (entity.dependencies || []).slice(0, 3).join(", ");
              process.stdout.write(
                `  ${chalk.cyan(entity.name)} [${entity.type}]${deps ? ` → ${deps}` : ""}\n`,
              );
            }
            if (result.relationships && result.relationships.length > 0) {
              process.stdout.write(chalk.bold("\n  Relationships:\n"));
              for (const rel of result.relationships.slice(0, 10)) {
                process.stdout.write(
                  `  ${rel.source} ${chalk.gray(`—${rel.type}→`)} ${rel.target}\n`,
                );
              }
            }
          } else {
            process.stdout.write(
              `  ${JSON.stringify(result).substring(0, 500)}\n`,
            );
          }
          process.stdout.write("\n");
          messages.push({
            role: "assistant",
            content: `[Cowork Graph] Analyzed ${(result.entities || []).length} entities with ${(result.relationships || []).length} relationships.`,
          });
        } catch (err) {
          logger.error(`Graph analysis failed: ${err.message}`);
        }
      } else if (subCmd === "decision" && coworkInput) {
        try {
          const { analyzeDecisions } =
            await import("../lib/cowork/decision-kb-cli.js");
          process.stdout.write(chalk.gray("\n  Analyzing decisions...\n"));
          const result = await analyzeDecisions({
            target: coworkInput,
            llmOptions: { provider, model, baseUrl, apiKey },
          });
          if (result.decisions && result.decisions.length > 0) {
            process.stdout.write(chalk.bold("  Architecture Decisions:\n"));
            for (const d of result.decisions) {
              const statusColor =
                d.status === "accepted"
                  ? chalk.green
                  : d.status === "rejected"
                    ? chalk.red
                    : chalk.yellow;
              process.stdout.write(
                `  ${statusColor(`[${d.status || "proposed"}]`)} ${chalk.cyan(d.title || d.id)}\n`,
              );
              if (d.rationale) {
                process.stdout.write(
                  `    ${chalk.gray(d.rationale.substring(0, 100))}\n`,
                );
              }
            }
          } else {
            process.stdout.write(
              `  ${JSON.stringify(result).substring(0, 500)}\n`,
            );
          }
          process.stdout.write("\n");
          messages.push({
            role: "assistant",
            content: `[Cowork Decision] Found ${(result.decisions || []).length} architecture decisions.`,
          });
        } catch (err) {
          logger.error(`Decision analysis failed: ${err.message}`);
        }
      } else {
        logger.info(
          "Usage: /cowork debate <file> | compare <prompt> | graph <path> | decision <topic>",
        );
      }

      prompt();
      return;
    }

    // Autonomous agent commands
    if (trimmed.startsWith("/auto")) {
      const autoArg = trimmed.slice(5).trim();

      if (!autoArg || autoArg === "help") {
        logger.log(chalk.bold("\nAutonomous Agent Commands:"));
        logger.log(
          `  ${chalk.cyan("/auto <goal>")}      Submit a goal for autonomous execution`,
        );
        logger.log(
          `  ${chalk.cyan("/auto status")}      Show current goal status`,
        );
        logger.log(
          `  ${chalk.cyan("/auto pause")}       Pause the running goal`,
        );
        logger.log(`  ${chalk.cyan("/auto resume")}      Resume a paused goal`);
        logger.log(
          `  ${chalk.cyan("/auto cancel")}      Cancel the running goal`,
        );
        logger.log(`  ${chalk.cyan("/auto list")}        List all goals`);
        logger.log("");
      } else if (autoArg === "status") {
        const goals = autonomousAgent.listGoals();
        const running = goals.find(
          (g) =>
            g.status === GoalStatus.RUNNING || g.status === GoalStatus.PAUSED,
        );
        if (running) {
          const detail = autonomousAgent.getGoalStatus(running.id);
          logger.info(`Goal: ${chalk.cyan(detail.description)}`);
          logger.info(
            `Status: ${detail.status}  Steps: ${detail.steps.length}  Iterations: ${detail.iterations}`,
          );
          for (const step of detail.steps) {
            const icon =
              step.status === "completed"
                ? "✓"
                : step.status === "running"
                  ? "→"
                  : step.status === "failed"
                    ? "✗"
                    : "○";
            logger.log(
              `  ${icon} ${step.description} ${step.error ? chalk.red(`(${step.error})`) : ""}`,
            );
          }
        } else {
          logger.info("No active goal. Use /auto <goal> to submit one.");
        }
      } else if (autoArg === "pause") {
        const goals = autonomousAgent.listGoals();
        const running = goals.find((g) => g.status === GoalStatus.RUNNING);
        if (running) {
          autonomousAgent.pauseGoal(running.id);
          logger.info(`Paused goal: ${running.description}`);
        } else {
          logger.info("No running goal to pause.");
        }
      } else if (autoArg === "resume") {
        const goals = autonomousAgent.listGoals();
        const paused = goals.find((g) => g.status === GoalStatus.PAUSED);
        if (paused) {
          autonomousAgent.resumeGoal(paused.id);
          logger.info(`Resumed goal: ${paused.description}`);
        } else {
          logger.info("No paused goal to resume.");
        }
      } else if (autoArg === "cancel") {
        const goals = autonomousAgent.listGoals();
        const active = goals.find(
          (g) =>
            g.status === GoalStatus.RUNNING || g.status === GoalStatus.PAUSED,
        );
        if (active) {
          autonomousAgent.cancelGoal(active.id);
          logger.info(`Cancelled goal: ${active.description}`);
        } else {
          logger.info("No active goal to cancel.");
        }
      } else if (autoArg === "list") {
        const goals = autonomousAgent.listGoals();
        if (goals.length === 0) {
          logger.info("No goals submitted yet.");
        } else {
          for (const g of goals) {
            logger.log(
              `  [${g.status}] ${g.description} (${g.steps} steps, ${g.iterations} iterations)`,
            );
          }
        }
      } else {
        // Submit new goal
        // Lazy-init autonomous agent with LLM chat function
        if (!autonomousAgent._initialized) {
          const chatFn = createChatFn({
            provider,
            model,
            baseUrl,
            apiKey,
            callWrapper: _directChatCallWrapper,
          });
          autonomousAgent.initialize({
            llmChat: chatFn,
            toolExecutor: _runReplDirectTool,
          });
        }

        // Set up event listeners for live output
        const goalListener = (evt) => {
          if (evt.goalId) {
            if (evt.result)
              process.stdout.write(
                chalk.green(`  Goal completed: ${evt.result}\n`),
              );
            if (evt.error)
              process.stdout.write(chalk.red(`  Goal failed: ${evt.error}\n`));
          }
        };
        const stepListener = (evt) => {
          process.stdout.write(chalk.gray(`  [step] ${evt.step}\n`));
        };

        // Attach the live-output listeners ONCE per REPL session — the agent is
        // a session-scoped singleton (created once above), so re-attaching on
        // every `/auto` would accumulate listeners (duplicate output + leak +
        // MaxListenersExceededWarning). The handlers are stateless.
        if (!autonomousAgent._replListenersAttached) {
          autonomousAgent._replListenersAttached = true;
          autonomousAgent.on("goal:completed", goalListener);
          autonomousAgent.on("goal:failed", goalListener);
          autonomousAgent.on("step:started", stepListener);
          autonomousAgent.on("step:completed", (evt) => {
            process.stdout.write(chalk.green(`  [done] ${evt.step}\n`));
          });
        }

        logger.info(`Submitting goal: ${chalk.cyan(autoArg)}`);
        try {
          const { goalId } = await autonomousAgent.submitGoal(autoArg);
          logger.info(
            `Goal ${goalId} submitted. Use /auto status to track progress.`,
          );
        } catch (err) {
          logger.error(`Failed to submit goal: ${err.message}`);
        }
      }

      prompt();
      return;
    }

    // Plan mode commands
    if (trimmed.startsWith("/plan")) {
      const planManager = getPlanModeManager();
      const subCmd = trimmed.slice(5).trim();

      if (!subCmd || subCmd === "enter") {
        if (planManager.isActive()) {
          logger.info(
            "Already in plan mode. Use /plan show, /plan approve, or /plan reject.",
          );
        } else {
          planManager.enterPlanMode({ title: "Agent Plan" });
          logger.success(
            "Entered plan mode. Write tools are blocked until you approve the plan.",
          );
          logger.info(
            "The AI can still read files and search. Blocked tools become plan items.",
          );
          logger.info(
            "Use /plan show to see the plan, /plan approve to execute.",
          );
          // Inject plan mode context into system prompt
          messages.push({
            role: "system",
            content:
              "[PLAN MODE ACTIVE] You are now in plan mode. You can read files, search, and analyze — but write/execute tools are blocked. Any blocked tool calls will be recorded as plan items. Analyze the task thoroughly, then the user will approve your plan.",
          });
        }
      } else if (subCmd === "show") {
        if (!planManager.isActive()) {
          logger.info("Not in plan mode. Use /plan to enter.");
        } else {
          logger.log("\n" + planManager.generatePlanSummary() + "\n");
        }
      } else if (subCmd === "approve" || subCmd === "yes") {
        if (!planManager.isActive()) {
          logger.info("No plan to approve.");
        } else if (planManager.currentPlan.items.length === 0) {
          logger.info(
            "Plan has no items yet. Let the AI analyze the task first.",
          );
        } else {
          // Review this immutable plan version before approval. Advisor output
          // cannot block or approve the plan and grants no extra authority; its
          // local-verification checklist is queued for the next main turn.
          if (_advisorRuntime?.status().enabled) {
            try {
              const result = await _advisorRuntime.reviewPlan(
                {
                  id: planManager.currentPlan.id,
                  title: planManager.currentPlan.title,
                  description: planManager.currentPlan.description,
                  summary: planManager.generatePlanSummary(),
                },
                { messages, signal: _turnAbort?.signal || null },
              );
              if (result.ok) {
                const { renderAdvisorAdvice } =
                  await import("./advisor-command.js");
                logger.log(renderAdvisorAdvice(result));
              } else if (result.effect !== "disabled") {
                logger.warn(result.error);
              }
            } catch (error) {
              logger.warn(`Advisor plan review skipped: ${error.message}`);
            }
          }
          planManager.approvePlan();
          logger.success(
            `Plan approved! ${planManager.currentPlan.items.length} items ready for execution.`,
          );
          logger.info(
            "Write/execute tools are now unlocked. The AI can proceed.",
          );
          messages.push({
            role: "system",
            content: `[PLAN APPROVED] The user has approved your plan with ${planManager.currentPlan.items.length} items. You can now use all tools including write_file, edit_file, run_shell, and run_skill. Execute the plan items in order.`,
          });
        }
      } else if (subCmd === "reject" || subCmd === "no") {
        if (!planManager.isActive()) {
          logger.info("No plan to reject.");
        } else {
          planManager.rejectPlan("User rejected");
          logger.info("Plan rejected. Exited plan mode.");
        }
      } else if (subCmd === "risk") {
        if (!planManager.isActive() || !planManager.currentPlan) {
          logger.info("No active plan to assess.");
        } else {
          const risk = planManager.getRiskAssessment();
          logger.log(
            `\nRisk Level: ${chalk.bold(risk.level.toUpperCase())} (total: ${risk.totalScore}, max: ${risk.maxScore}, avg: ${risk.averageScore})`,
          );
          for (const item of risk.itemScores) {
            const color =
              item.score >= 6
                ? chalk.red
                : item.score >= 3
                  ? chalk.yellow
                  : chalk.green;
            logger.log(`  ${color(`[${item.score}]`)} ${item.title}`);
          }
          logger.log("");
        }
      } else if (subCmd === "execute") {
        if (!planManager.isActive()) {
          logger.info("No active plan.");
        } else if (planManager.state !== PlanState.APPROVED) {
          logger.info("Plan must be approved first. Use /plan approve.");
        } else {
          logger.info("Executing plan items in DAG order...");
          try {
            const { results, success } = await planManager.executePlan(
              async (item) => {
                if (item.tool && item.params) {
                  process.stdout.write(
                    chalk.gray(`  [${item.tool}] ${item.title}\n`),
                  );
                  return await _runReplDirectTool(item.tool, item.params);
                }
                return { skipped: true };
              },
            );
            for (const r of results) {
              const icon = r.success ? chalk.green("✓") : chalk.red("✗");
              logger.log(
                `  ${icon} ${r.item.title}${r.error ? ` — ${r.error}` : ""}`,
              );
            }
            logger.info(
              `Plan execution ${success ? "completed" : "finished with errors"}.`,
            );
            planManager.exitPlanMode({ savePlan: true });
          } catch (err) {
            logger.error(`Plan execution failed: ${err.message}`);
          }
        }
      } else if (subCmd === "exit") {
        if (planManager.isActive()) {
          planManager.exitPlanMode({ savePlan: true });
          logger.info("Exited plan mode.");
        } else {
          logger.info("Not in plan mode.");
        }
      } else if (subCmd.startsWith("interactive")) {
        // Interactive planning with LLM-generated plan + skill recommendations
        const planRequest =
          subCmd.slice(11).trim() || "Help me with the current task";
        try {
          const { CLIInteractivePlanner } =
            await import("../lib/interactive-planner.js");
          const { TerminalInteractionAdapter } =
            await import("../lib/interaction-adapter.js");
          const chatFn = createChatFn({
            provider,
            model,
            baseUrl,
            apiKey,
            callWrapper: _directChatCallWrapper,
          });
          const planner = new CLIInteractivePlanner({
            llmChat: chatFn,
            db,
            interaction: new TerminalInteractionAdapter(),
          });

          logger.info("Generating interactive plan...");
          const result = await planner.startPlanSession(planRequest, {
            cwd: process.cwd(),
          });

          if (result.plan) {
            logger.log(
              chalk.bold(
                `\n  Plan: ${result.plan.overview?.title || "Untitled"}`,
              ),
            );
            logger.log(
              chalk.gray(`  ${result.plan.overview?.description || ""}\n`),
            );
            for (const step of result.plan.steps || []) {
              const toolStr = step.tool ? chalk.cyan(` [${step.tool}]`) : "";
              logger.log(`  ${step.step}. ${step.title}${toolStr}`);
            }
            if (result.plan.recommendations?.skills?.length > 0) {
              logger.log(chalk.bold("\n  Recommended skills:"));
              for (const s of result.plan.recommendations.skills) {
                logger.log(`    - ${chalk.cyan(s.id)}: ${s.description}`);
              }
            }
            logger.log("");
            logger.info(
              "Use /plan interactive:confirm, /plan interactive:cancel, or /plan interactive:regenerate",
            );
          } else {
            logger.info(result.message || "Failed to generate plan");
          }
        } catch (err) {
          logger.error(`Interactive plan failed: ${err.message}`);
        }
      } else {
        logger.info(
          "Unknown /plan subcommand. Try: /plan, /plan show, /plan approve, /plan reject, /plan exit, /plan interactive <request>",
        );
      }

      prompt();
      return;
    }

    // `/sessions` — list recent RESUMABLE conversations (read-only; the ids
    // work with `cc agent --resume <id>`). `/session` shows the current one.
    if (trimmed === "/sessions" || trimmed.startsWith("/sessions ")) {
      try {
        const { listRecentSessions } = await import("../lib/recent-session.js");
        const { renderRecentSessions } = await import("./recent-sessions.js");
        const sessions = listRecentSessions({ db: _hookDb }, { scan: 20 });
        logger.log(renderRecentSessions(sessions, { currentId: sessionId }));
      } catch (err) {
        logger.error(chalk.red(`/sessions failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/memory` — project-memory files auto-loaded into the system prompt
    // (cc.md hierarchy + imports + path-scoped rules). Distinct from `#` (add
    // a note) and `cc memory recall` (scoped store).
    if (trimmed === "/memory" || trimmed.startsWith("/memory ")) {
      try {
        const { loadProjectInstructions } =
          await import("../lib/project-instructions.js");
        const { renderMemoryFiles } = await import("./memory-status.js");
        const loaded = loadProjectInstructions({ cwd: process.cwd() });
        logger.log(
          renderMemoryFiles(loaded, {
            enabled: process.env.CC_PROJECT_MEMORY !== "0",
          }),
        );
      } catch (err) {
        logger.error(chalk.red(`/memory failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/mcp` — overview of connected MCP servers' resources + prompts.
    if (trimmed === "/mcp" || trimmed.startsWith("/mcp ")) {
      const mcpClient = _getReplHostMcp()?.mcpClient;
      logger.log(renderMcpSurface(mcpClient));
      prompt();
      return;
    }

    // `/config` — effective configuration (secret-safe): the LLM provider/model
    // in effect, whether keys are set, web-search backend, config path.
    // `/config <key>` reads a value; `/config <key>=<value>` (Claude-Code
    // parity) or `/config <key> <value>` persists one. Secrets stay masked.
    if (trimmed === "/config" || trimmed.startsWith("/config ")) {
      try {
        const cm = await import("../lib/config-manager.js");
        const { getConfigPath } = await import("../lib/paths.js");
        const {
          renderConfigSummary,
          parseConfigCommand,
          renderConfigGet,
          renderConfigSet,
          renderConfigHelp,
        } = await import("./config-summary.js");
        const cmd = parseConfigCommand(trimmed.slice("/config".length));
        if (cmd.action === "error") {
          logger.error(chalk.red(`/config: ${cmd.message}`));
        } else if (cmd.action === "help") {
          logger.log(renderConfigHelp());
        } else if (cmd.action === "get") {
          logger.log(
            renderConfigGet(
              cmd.key,
              cm.getConfigValue(cmd.key, { resolveSecrets: false }),
            ),
          );
        } else if (cmd.action === "set") {
          cm.setConfigValue(cmd.key, cmd.value);
          logger.log(
            chalk.green("✓ ") +
              renderConfigSet(cmd.key, cm.getConfigValue(cmd.key)),
          );
          logger.log(
            chalk.gray(
              "  (persisted; provider/model changes apply to new sessions)",
            ),
          );
        } else {
          logger.log(
            renderConfigSummary(cm.loadConfig(), {
              path: getConfigPath(),
              activeProvider: provider,
              activeModel: _curModel || model,
            }),
          );
        }
      } catch (err) {
        logger.error(chalk.red(`/config failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/doctor` — consolidated session-health readout (Claude-Code parity):
    // provider/key/IDE/MCP/permissions/hooks in one pass-or-warn view.
    // `/checkup` is the Claude-Code 2.1.205 alias for the same readout.
    if (
      trimmed === "/doctor" ||
      trimmed.startsWith("/doctor ") ||
      trimmed === "/checkup" ||
      trimmed.startsWith("/checkup ")
    ) {
      let config = {};
      try {
        config = (await import("../lib/config-manager.js")).loadConfig() || {};
      } catch (_err) {
        // config read is best-effort; checks degrade gracefully
      }
      const { buildDoctorChecks, renderDoctor } =
        await import("./doctor-status.js");
      const { ideToolNames } = await import("./ide-status.js");
      const checks = buildDoctorChecks({
        config,
        ideTools: ideToolNames(_adhocMcp),
        mcpServers: _adhocMcp?.connected,
        permissionRules: _permissionRules,
        settingsHooks: _settingsHooks,
      });
      logger.log(renderDoctor(checks));
      prompt();
      return;
    }

    // `/status` — concise environment snapshot (version / model / session / cwd
    // / roots / IDE·MCP·hooks). Lighter than /doctor. Claude-Code /status parity
    // (minus account/billing, which cc has no notion of).
    if (trimmed === "/status" || trimmed.startsWith("/status ")) {
      try {
        const { VERSION } = await import("../constants.js");
        const { readDiskVersion } = await import("../lib/version-skew.js");
        const { ideToolNames } = await import("./ide-status.js");
        const { formatStatus } = await import("./status-summary.js");
        const mcpConnected = _adhocMcp?.connected;
        const mcpCount = Array.isArray(mcpConnected)
          ? mcpConnected.length
          : typeof mcpConnected === "number"
            ? mcpConnected
            : mcpConnected
              ? 1
              : 0;
        logger.log(
          "\n" +
            formatStatus({
              version: VERSION,
              installedVersion: readDiskVersion(),
              node: process.version,
              platform: `${process.platform}-${process.arch}`,
              provider,
              model: _curModel || model,
              sessionId,
              messageCount: messages.length,
              cwd: process.cwd(),
              extraRoots: additionalDirectories.length,
              ideConnected: ideToolNames(_adhocMcp).length > 0,
              mcpServers: mcpCount,
              hookEvents: _settingsHooks
                ? Object.keys(_settingsHooks).length
                : 0,
            }) +
            "\n",
        );
      } catch (err) {
        logger.error(chalk.red(`/status failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/release-notes` — running version + a pointer to the full changelog +
    // how to upgrade. Claude-Code /release-notes parity.
    if (trimmed === "/release-notes" || trimmed.startsWith("/release-notes ")) {
      try {
        const { VERSION } = await import("../constants.js");
        const { readDiskVersion } = await import("../lib/version-skew.js");
        const { formatReleaseNotes } = await import("./release-notes.js");
        logger.log(
          "\n" +
            formatReleaseNotes({
              version: VERSION,
              installedVersion: readDiskVersion(),
            }) +
            "\n",
        );
      } catch (err) {
        logger.error(chalk.red(`/release-notes failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/export [path]` — dump the live conversation to a Markdown transcript
    // (Claude-Code parity). Distinct from `cc export` (knowledge base). Captures
    // exactly what's in context now, persisted or not.
    if (trimmed === "/export" || trimmed.startsWith("/export ")) {
      const arg = trimmed.slice("/export".length).trim();
      try {
        const { renderConversationMarkdown, defaultExportFilename } =
          await import("./conversation-export.js");
        const fs = await import("fs");
        const path = await import("path");
        const md = renderConversationMarkdown(messages, {
          provider,
          model: _curModel || model,
          sessionId,
          exportedAt: new Date().toISOString(),
        });
        const file = arg
          ? path.resolve(process.cwd(), arg)
          : path.resolve(process.cwd(), defaultExportFilename(new Date()));
        fs.writeFileSync(file, md, "utf-8");
        logger.log(
          chalk.green(`Exported ${messages.length} messages → ${file}`),
        );
      } catch (err) {
        logger.error(chalk.red(`/export failed: ${err.message}`));
      }
      prompt();
      return;
    }

    // `/permissions` — allow/ask/deny rules in effect this session (Claude-Code
    // parity): what the agent runs unprompted, asks about, or is blocked from.
    if (trimmed === "/permissions" || trimmed.startsWith("/permissions ")) {
      const arg = trimmed.slice("/permissions".length).trim();
      if (arg === "denials" || arg === "denied") {
        // Review what the agent was BLOCKED from running this session
        // (Claude-Code 2.1.193 "recent denials").
        logger.log(formatDenials(_recentDenials));
        logger.log(
          chalk.gray(
            "  Cross-session history (headless + REPL): cc permissions recent",
          ),
        );
        prompt();
        return;
      }
      if (arg) {
        // Set this session's permission mode mid-session (Claude-Code
        // permission-mode / Shift+Tab parity; mirrors `cc session policy --set`).
        const parsed = parsePermissionModeArg(arg);
        if (!parsed) {
          logger.info(
            "Usage: /permissions [strict|trusted|autopilot|auto|dontask]  " +
              "(aliases: default · manual · accept-edits · bypass). No arg = show rules.",
          );
        } else if (
          !_approvalGate ||
          !sessionId ||
          typeof _approvalGate.setSessionPolicy !== "function"
        ) {
          logger.info(
            "Approval gate not available this session — can't change the tier.",
          );
        } else {
          try {
            _approvalGate.setSessionPolicy(sessionId, parsed.tier);
            _sessionTier = parsed.auto
              ? "auto"
              : parsed.dontAsk
                ? "dontAsk"
                : parsed.tier;
            logger.info(
              `Approval policy → ${chalk.cyan(_sessionTier)} ${chalk.gray(`(${describeTier(_sessionTier)})`)}`,
            );
            if (parsed.auto) {
              if (_autoModeResolved?.customized) {
                const m = _autoModeResolved.map;
                logger.info(
                  chalk.gray(
                    `  autoMode.decisions: low→${m.low.decision} · medium→${m.medium.decision} · high→${m.high.decision}  (cc auto-mode config for sources)`,
                  ),
                );
              } else {
                logger.info(
                  chalk.gray(
                    "  no customized autoMode.decisions in settings — auto behaves like trusted",
                  ),
                );
              }
            }
          } catch (_err) {
            logger.info("Could not set the approval policy.");
          }
        }
        prompt();
        return;
      }
      let files = [];
      try {
        const { loadSettings } = await import("../lib/settings-loader.cjs");
        files = loadSettings({ cwd: process.cwd() }).files || [];
      } catch (_err) {
        // source listing is best-effort — still show the live rules
      }
      const { renderPermissions } = await import("./permissions-status.js");
      logger.log(renderPermissions(_permissionRules, { files }));
      logger.log(
        chalk.gray(
          `  Current mode: ${_sessionTier} (${describeTier(_sessionTier)})`,
        ),
      );
      logger.log(
        chalk.gray(
          "  Set tier mid-session: /permissions <strict|trusted|autopilot|auto|dontask>",
        ),
      );
      if (_recentDenials.length) {
        logger.log(
          chalk.gray(
            `  ${_recentDenials.length} tool call(s) denied this session — /permissions denials to review`,
          ),
        );
      }
      prompt();
      return;
    }

    // `/remote-control` — pair a phone/web device to answer this session's
    // permission prompts (批17 slash 入口 + 批18 REPL 接线). First answer —
    // terminal or device — wins; devices get permission.request cards + push.
    if (
      trimmed === "/remote-control" ||
      trimmed.startsWith("/remote-control ") ||
      trimmed === "/rc" ||
      trimmed.startsWith("/rc ")
    ) {
      const arg = trimmed
        .replace(/^\/(remote-control|rc)/, "")
        .trim()
        .toLowerCase();
      if (arg === "off" || arg === "stop") {
        if (!_remoteApproval) {
          logger.info("remote-control is not active.");
        } else {
          await _stopRemoteApproval();
          logger.info(
            "remote-control stopped — approvals are local-only again.",
          );
        }
      } else if (arg === "status") {
        if (!_remoteApproval) {
          logger.info("remote-control: off — start with /remote-control");
        } else {
          logger.log(`  pairing: ${_remoteApproval.pairing.uri}`);
          const approvers = await _remoteApproval.bridge.approverCount();
          logger.log(
            `  paired approvers: ${approvers}${approvers === 0 ? "  (scan the pairing URI from the mobile app or web panel)" : ""}`,
          );
        }
      } else if (arg === "" || arg === "on" || arg === "start") {
        if (_remoteApproval) {
          logger.info(
            "remote-control already running — /remote-control status",
          );
        } else {
          try {
            await _startRemoteApproval();
          } catch (err) {
            logger.info(`remote-control failed to start: ${err.message}`);
          }
        }
      } else {
        logger.info("Usage: /remote-control [on|off|status]   (alias /rc)");
      }
      prompt();
      return;
    }

    // `/cost` — running token spend + estimated $ for this session (Claude-Code
    // parity). In-memory accumulation, so it works without session persistence.
    if (trimmed === "/cost" || trimmed.startsWith("/cost ")) {
      let overrides;
      let visionModel;
      try {
        const { loadConfig } = await import("../lib/config-manager.js");
        const cfg = loadConfig();
        overrides = cfg?.llm?.pricing;
        visionModel = cfg?.llm?.visionModel;
      } catch (_err) {
        // config is optional — fall back to the built-in pricing table
      }
      // Category breakdown (Claude-Code parity): classify spend by model role —
      // the live model is "main", the vision model "vision", the fallback chain
      // "fallback", a switched-to model "other". Shown only when >1 was used.
      const roles = {
        mainProvider: provider,
        mainModel: _curModel || model,
        visionModel: visionModel || "doubao-seed-2-0-lite-260215",
        fallbackModels: _fallbackModels || [],
      };
      const { renderSessionCost } = await import("./session-cost.js");
      logger.log(
        renderSessionCost(_costStore, { pricingOverrides: overrides, roles }),
      );
      prompt();
      return;
    }

    // `/copy` — copy the last assistant response to the system clipboard
    // (Claude-Code /copy parity). `/copy code` copies the last fenced code block.
    if (trimmed === "/copy" || trimmed.startsWith("/copy ")) {
      const arg = trimmed.slice("/copy".length).trim().toLowerCase();
      const { lastAssistantText, lastCodeBlock, copyToClipboard } =
        await import("./clipboard-copy.js");
      const full = lastAssistantText(messages);
      if (!full) {
        logger.log(
          chalk.gray(
            "Nothing to copy yet — no assistant response in this session.",
          ),
        );
        prompt();
        return;
      }
      let payload = full;
      let what = "last response";
      if (arg === "code") {
        const block = lastCodeBlock(full);
        if (!block) {
          logger.log(chalk.gray("No fenced code block in the last response."));
          prompt();
          return;
        }
        payload = block;
        what = "last code block";
      }
      const res = copyToClipboard(payload);
      if (res.ok) {
        logger.log(
          chalk.gray(
            `Copied ${what} to clipboard (${payload.length} chars, ${res.tool}).`,
          ),
        );
      } else {
        logger.error(chalk.red(`/copy failed: ${res.error}`));
        logger.log(
          chalk.gray(
            "Install a clipboard tool (Linux: wl-copy / xclip / xsel).",
          ),
        );
      }
      prompt();
      return;
    }

    // `/ide` — IDE bridge connection status (Claude-Code parity): which editor
    // is connected, its tools, or why discovery came up empty.
    if (trimmed === "/ide" || trimmed.startsWith("/ide ")) {
      let diag = null;
      try {
        const { diagnoseIde } = await import("../lib/ide-bridge.js");
        diag = diagnoseIde({ cwd: process.cwd(), env: process.env });
      } catch (_err) {
        // discovery is best-effort — fall back to in-session tools only
      }
      const { renderIdeStatus } = await import("./ide-status.js");
      logger.log(renderIdeStatus(_adhocMcp, diag));
      prompt();
      return;
    }

    // User-defined slash-command macros (.claude/commands/*.md), Claude-Code
    // parity. resolveSlashMacro maps a leading /name to a command macro and
    // expands its template; a non-match returns the line unchanged so a literal
    // prompt like "/etc/hosts" still reaches the LLM. Wire is unit-tested.
    // Under --disable-slash-commands the sentinel never reached a handler;
    // restore the user's real text so the model sees it verbatim.
    let promptText = _slashBypassed ? rawLine : trimmed;

    // MCP server-provided prompts (Claude-Code parity): `/mcp__<server>__<name>
    // [json-args]` fetches a rendered prompt template from the connected MCP
    // server and uses its text as this turn's input. Falls through unchanged
    // when the line isn't an MCP prompt command.
    if (!_slashBypassed && promptText.startsWith("/mcp__")) {
      try {
        const expanded = await expandMcpPrompt(
          promptText,
          _getReplHostMcp()?.mcpClient,
        );
        if (expanded != null) {
          promptText = expanded;
          logger.log(chalk.gray(`[mcp] prompt expanded`));
        }
      } catch (err) {
        logger.info(
          chalk.yellow(`[mcp] prompt expansion failed: ${err.message}`),
        );
        prompt();
        return;
      }
    }

    // `/pr-comments [<n>|<url>] [--repo owner/name]` (Claude-Code parity):
    // fetch a GitHub PR's reviews + conversation + inline comments via `gh` and
    // feed them as this turn's input so the agent can address the feedback.
    if (!_slashBypassed && promptText.startsWith("/pr-comments")) {
      try {
        const { expandPrComments } = await import("./pr-comments.js");
        const res = await expandPrComments(promptText);
        if (res != null) {
          promptText = res.text;
          logger.log(
            chalk.gray(
              `[pr] PR #${res.number}: ${res.count} comment(s) fetched`,
            ),
          );
        }
      } catch (err) {
        logger.info(chalk.yellow(`[pr-comments] ${err.message}`));
        prompt();
        return;
      }
    }

    try {
      const macro = await resolveSlashMacro(trimmed, { cwd: process.cwd() });
      if (macro.matched) {
        for (const w of macro.warnings)
          logger.info(chalk.yellow(`[@ref] ${w}`));
        promptText = macro.promptText;
        logger.log(
          chalk.gray(`[/${macro.name}] macro expanded (${macro.scope})`),
        );
      }
    } catch (err) {
      logger.verbose(`[slash-macro] expansion skipped: ${err.message}`);
    }

    // Fire UserPromptSubmit hook with rewrite/abort support.
    // Hooks may emit {"rewrittenPrompt": "..."} or {"abort": true, "reason": "..."}
    // via stdout JSON. Failures fall through to the original prompt.
    const promptDirective = await fireUserPromptSubmit(_hookDb, promptText, {
      sessionId,
      messageCount: messages.length,
    });
    if (promptDirective.abort) {
      logger.info(
        chalk.yellow(
          `[hook] prompt aborted${promptDirective.reason ? `: ${promptDirective.reason}` : ""}`,
        ),
      );
      prompt();
      return;
    }
    const effectivePrompt = promptDirective.prompt;
    if (effectivePrompt !== promptText) {
      logger.verbose(`[hook] prompt rewritten by UserPromptSubmit hook`);
    }

    // Backstop: if the previous turn's agentLoop threw before the success-path
    // restore ran, undo its /note-next guidance so it never leaks into this turn's
    // history/model call. (Normal turns clear _btwRestore right after agentLoop.)
    if (_btwRestore) {
      _btwRestore.msg.content = _btwRestore.content;
      _btwRestore = null;
    }

    // Expand @path file references into context blocks (Claude-Code parity),
    // so `review @src/x.js` injects the file contents. Typo'd paths are warned
    // about and left as-is.
    let userContent = effectivePrompt;
    try {
      const fileRefs = await expandFileRefsAsync(effectivePrompt, {
        cwd: process.cwd(),
      });
      userContent = fileRefs.prompt;
      for (const w of fileRefs.warnings) {
        logger.info(chalk.yellow(`[@ref] ${w}`));
      }
      if (fileRefs.refs.length > 0) {
        const summary = fileRefs.refs
          .map((r) => `${r.rel}${r.kind === "dir" ? "/" : ""}`)
          .join(", ");
        logger.verbose(`[@ref] injected: ${summary}`);
      }
    } catch (err) {
      logger.verbose(`[@ref] expansion skipped: ${err.message}`);
    }

    // settings.json UserPromptSubmit hooks (decision-capable; the DB hook above
    // is observe-only). block → abort the turn; context → inject before the turn.
    if (_settingsHooks) {
      try {
        const { runUserPromptSubmitHooks } =
          await import("../lib/settings-hook-events.js");
        const ups = runUserPromptSubmitHooks(_settingsHooks, {
          prompt: userContent,
          cwd: process.cwd(),
          sessionId,
        });
        if (ups.blocked) {
          logger.info(
            chalk.yellow(
              `[hook] prompt blocked${ups.reason ? ": " + ups.reason : ""}`,
            ),
          );
          prompt();
          return;
        }
        if (ups.additionalContext) {
          userContent += `\n\n[hook context]\n${ups.additionalContext}`;
        }
        // Fire-and-forget the `async:true` UserPromptSubmit hooks (Phase 6): a
        // long-running check (background tests, CI status) runs ALONGSIDE this
        // turn without blocking it; its result/rewake surfaces on a later turn
        // via the async-hook drain below. Lazily create the supervisor.
        const { dispatchAsyncHooks } =
          await import("../lib/settings-hook-events.js");
        if (!_asyncHookSupervisor) {
          const { AsyncHookSupervisor } =
            await import("../lib/async-hook-supervisor.js");
          _asyncHookSupervisor = new AsyncHookSupervisor({
            persistStats: true,
          });
        }
        dispatchAsyncHooks(
          _settingsHooks,
          "UserPromptSubmit",
          { prompt: userContent },
          { cwd: process.cwd(), supervisor: _asyncHookSupervisor },
        );
      } catch (_err) {
        // settings hook dispatch is best-effort
      }
    }

    // Plugin background-monitor output (Phase 3.3i/Phase 6): surface anything a
    // trusted plugin's monitor captured SINCE the last turn as additionalContext,
    // so the agent sees e.g. a background test failure or a tailed log on its
    // next turn. Drained (cleared) so each line is shown once; bounded so a noisy
    // monitor can't blow up the prompt.
    if (_pluginMonitors) {
      try {
        const recs = _pluginMonitors.drainOutputs();
        if (recs.length > 0) {
          const shown = recs.slice(-40);
          const lines = shown
            .map((r) => `  [${r.monitor}/${r.stream}] ${r.line}`)
            .join("\n");
          const omitted =
            recs.length > shown.length
              ? `\n  … (${recs.length - shown.length} earlier line(s) omitted)`
              : "";
          userContent += `\n\n[plugin monitors — new output since last turn]\n${lines}${omitted}`;
        }
      } catch (_err) {
        // monitor drain is best-effort — never blocks a turn
      }
    }

    // Async settings-hook output (Phase 6): fold in any `async:true` hook that
    // FINISHED since the last turn. Failed `asyncRewake` hooks are surfaced
    // first + prominently (the "rewake" — a background test failure re-engages
    // the agent with the structured error) followed by the plain results.
    // Drained (cleared) so each is shown once.
    if (_asyncHookSupervisor) {
      try {
        const rewakes = _asyncHookSupervisor.drainRewakes();
        const results = _asyncHookSupervisor.drainResults();
        if (rewakes.length > 0) {
          const lines = rewakes
            .map(
              (r) =>
                `  ✗ ${r.command}${r.event ? ` (${r.event})` : ""}: ${
                  r.error || "failed"
                }`,
            )
            .join("\n");
          userContent += `\n\n[async hook — REWAKE: a background hook failed, address it]\n${lines}`;
        }
        // Non-rewake informational results (successful context / non-opted
        // failures). Rewake records already shown above are excluded to avoid
        // duplication.
        const info = results.filter((r) => !(r.asyncRewake === true && !r.ok));
        const ctxLines = info
          .map((r) => {
            if (r.skipped) return `  … ${r.command}: ${r.error}`;
            if (r.ok && r.additionalContext)
              return `  ✔ ${r.command}: ${r.additionalContext}`;
            if (!r.ok) return `  ✗ ${r.command}: ${r.error || "failed"}`;
            return null;
          })
          .filter(Boolean);
        if (ctxLines.length > 0) {
          userContent += `\n\n[async hooks — finished since last turn]\n${ctxLines
            .slice(-20)
            .join("\n")}`;
        }
      } catch (_err) {
        // async-hook drain is best-effort — never blocks a turn
      }
    }

    // IDE live context (Claude-Code parity): re-shared on every prompt while
    // an IDE bridge is connected — the user's selection moves between turns.
    // Ephemeral: persistence stores effectivePrompt, not this snapshot.
    // Best-effort; CC_IDE_CONTEXT=0 disables.
    try {
      const { buildIdePromptContext, expandIdeMentions } =
        await import("../lib/ide-context.js");
      const hostMcp = _getReplHostMcp();
      const ideCtx = await buildIdePromptContext(hostMcp);
      if (ideCtx) userContent += `\n\n${ideCtx}`;
      // Explicit @selection / @diagnostics mentions (Claude-Code parity);
      // scan the user's original prompt, append the expansion ephemerally.
      const mentioned = await expandIdeMentions(effectivePrompt, hostMcp);
      for (const w of mentioned.warnings) {
        logger.info(chalk.yellow(`[@ide] ${w}`));
      }
      if (mentioned.block) userContent += `\n\n${mentioned.block}`;
    } catch (_err) {
      // optional polish — never fail the turn over it
    }

    // Claude-Code-style: auto-attach local image paths typed in the message so
    // "describe ./shot.png" reads the image via the vision model (same as the
    // chat panels). CC_AUTO_IMAGE=0 opts out. `_visionLlm` (truthy on an image
    // turn) overrides this turn's provider/model/baseUrl/apiKey below. The
    // composition is the unit-tested `prepareVisionTurn` helper.
    let _visionLlm = null;
    let _userMessageContent = userContent;
    if (process.env.CC_AUTO_IMAGE !== "0") {
      try {
        const turn = prepareVisionTurn(userContent, {
          provider,
          baseUrl,
          apiKey,
          visionModel: _visionModel,
        });
        if (turn.visionLlm) {
          _userMessageContent = turn.content;
          _visionLlm = turn.visionLlm;
          logger.info(
            chalk.gray(
              `[image] ${turn.images.length} attached → vision model ${turn.visionLlm.model}`,
            ),
          );
        }
      } catch (e) {
        // Bad attachment (e.g. unreadable file) → send as plain text.
        _visionLlm = null;
        _userMessageContent = userContent;
        logger.info(chalk.yellow(`[image] ${e.message} — sending as text`));
      }
    }

    if (_turnBindingCriticalError) {
      logger.error(
        `[recovery] critical turn-binding state is unavailable: ${_turnBindingCriticalError.message}. ` +
          "Resume or start a healthy session before running another model/tool turn.",
      );
      prompt();
      return;
    }

    // Explicit clipboard attachment chips are consumed only when a real model
    // turn is about to start. They compose with auto-detected path images and
    // enter the same provider-neutral multimodal message/vision override.
    const clipboardImageChips = _promptInteractions.takeClipboardImageChips();
    const clipboardMerge = mergeClipboardImageChips(
      _userMessageContent,
      clipboardImageChips,
    );
    if (clipboardMerge.attached > 0) {
      _userMessageContent = clipboardMerge.content;
      if (!_visionLlm) {
        _visionLlm = resolveVisionLlm({
          hasImage: true,
          flags: {},
          llm: {
            provider,
            baseUrl,
            apiKey,
            visionModel: _visionModel,
          },
        });
      }
      logger.info(
        chalk.gray(
          `[image] ${clipboardMerge.attached} clipboard image(s) attached -> vision model ${_visionLlm.model}`,
        ),
      );
    }

    // Add user message (keep the object ref so /note-next can be injected for
    // this turn's model call and then stripped before persistence).
    const _userMsg = { role: "user", content: _userMessageContent };
    messages.push(_userMsg);

    // P1 turn→checkpoint binding: anchor this turn in the explicit table at
    // `conversationOffset = messages.length` measured just AFTER the user
    // message was appended (the exact-match contract pickPersistedTurn relies
    // on — same anchor as the headless runner). Only JSONL sessions can
    // persist the table; the producer supersedes stale records from a
    // discarded timeline (post-/rewind, /clear, compaction) itself.
    if (sessionId && useJsonl) {
      try {
        if (!_turnBindingProducer) {
          const { createReplTurnBindingProducer } =
            await import("./repl-turn-binding.js");
          _turnBindingProducer = createReplTurnBindingProducer({
            sessionId,
            onError: (error, phase) => {
              _turnBindingCriticalError = error;
              logger.warn(
                `[recovery] turn binding ${phase} failed for ${sessionId}: ${error.message}`,
              );
            },
          });
        }
        _turnBindingProducer?.beginTurn(messages.length, {
          worktreeId: options.worktreeId ?? null,
        });
      } catch (error) {
        _turnBindingCriticalError =
          error instanceof Error ? error : new Error(String(error));
        if (messages[messages.length - 1] === _userMsg) messages.pop();
        logger.error(
          `[recovery] refusing the turn because binding state is unavailable: ${_turnBindingCriticalError.message}`,
        );
        prompt();
        return;
      }
    }

    // Slot-filling: detect intent and fill missing parameters interactively
    try {
      const { CLISlotFiller } = await import("../lib/slot-filler.js");
      const intent = CLISlotFiller.detectIntent(promptText);
      if (intent) {
        const defs = CLISlotFiller.getSlotDefinitions(intent.type);
        const missing = defs.required.filter((s) => !intent.entities[s]);
        if (missing.length > 0) {
          const { TerminalInteractionAdapter } =
            await import("../lib/interaction-adapter.js");
          const interaction = new TerminalInteractionAdapter();
          const filler = new CLISlotFiller({ interaction });
          const result = await filler.fillSlots(intent, {
            cwd: process.cwd(),
          });
          if (result.filledSlots.length > 0) {
            const parts = Object.entries(result.entities)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}: ${v}`);
            // Append context to the last user message
            const lastMsg = messages[messages.length - 1];
            const slotContext = `[Context - user provided: ${parts.join(", ")}]`;
            if (Array.isArray(lastMsg.content)) {
              const textPart = lastMsg.content.find(
                (part) => part?.type === "text",
              );
              if (textPart)
                textPart.text = `${textPart.text}\n\n${slotContext}`;
              else lastMsg.content.unshift({ type: "text", text: slotContext });
            } else {
              lastMsg.content = `${lastMsg.content}\n\n${slotContext}`;
            }
            logger.info(chalk.gray(`[slot-fill] ${parts.join(", ")}`));
          }
        }
      }
    } catch (_err) {
      // Slot-filling failure is non-critical
    }

    // Auto-select best model based on task type — but ONLY onto a runnable
    // provider. The selector maps e.g. "fast" → claude-haiku on anthropic; if
    // there's no usable key for the provider, never switch there (you'd just
    // get a 401). Runnable-first: keep the configured (working) model instead.
    let activeModel = model;
    const taskDetection = detectTaskType(promptText);
    if (taskDetection.confidence > 0.3) {
      const recommended = selectModelForTask(provider, taskDetection.taskType);
      const switchTo = runnableTaskModel({
        provider,
        currentModel: activeModel,
        recommended,
        apiKey,
      });
      if (switchTo) {
        activeModel = switchTo;
        logger.info(
          chalk.gray(`[auto] ${taskDetection.name} → ${activeModel}`),
        );
      } else if (
        recommended &&
        recommended !== activeModel &&
        !hasUsableKey(provider, { apiKey })
      ) {
        logger.info(
          chalk.gray(
            `[auto] ${taskDetection.name}: keeping ${activeModel} — no usable key for "${provider}" (skipping ${recommended})`,
          ),
        );
      }
    }

    // Fast mode (P2#12): minimize reasoning + swap to the provider's
    // low-latency model for this turn (never over a pinned model). Applied
    // after auto-selection so it has the last word on latency.
    let turnThinking = thinking;
    if (_fastMode) {
      const fastPlan = _resolveFastPlan({
        enabled: true,
        provider,
        model: activeModel,
        modelPinned: _modelPinned,
      });
      turnThinking = fastPlan.thinking;
      if (fastPlan.swapped) activeModel = fastPlan.model;
      logger.info(chalk.gray(`[fast] ${fastPlan.note}`));
    }

    try {
      process.stdout.write("\n");
      const iterationBudget = new IterationBudget({ owner: sessionId });
      // Bind a cross-session goal (cc goal) into this run, if one resolves.
      // Composes WITH defaultPrepareCall — never replaces it. Best-effort.
      let prepareCall = defaultPrepareCall;
      try {
        const { resolveActiveGoal } = await import("../lib/goal-store.js");
        const boundGoal = resolveActiveGoal({ sessionId });
        if (boundGoal) {
          const { goalPrepareCall, composePrepareCall } =
            await import("../lib/goal-context.js");
          prepareCall = composePrepareCall([
            defaultPrepareCall,
            goalPrepareCall(boundGoal),
          ]);
        }
      } catch (_e) {
        /* goal binding is best-effort — fall back to defaultPrepareCall */
      }
      _turnAbort = new AbortController();
      if (_advisorRuntime) {
        _advisorRuntime.beginTurn(
          `${sessionId || "ephemeral"}:${_turnCount + 1}`,
        );
        prepareCall = _advisorRuntime.createPrepareCall({
          messages,
          basePrepareCall: prepareCall,
          subject: promptText,
          signal: _turnAbort.signal,
          onAdvice: async (result) => {
            if (!result.ok) {
              if (result.effect !== "disabled") {
                process.stderr.write(`  Advisor: ${result.error}\n`);
              }
              return;
            }
            const { renderAdvisorAdvice } =
              await import("./advisor-command.js");
            process.stderr.write(`\n${renderAdvisorAdvice(result)}\n`);
          },
        });
      }
      // Live streaming hooks: write the answer token-by-token, and stream the
      // reasoning dimmed before it. Skipped (left undefined) in replay mode.
      let _liveStreamed = false;
      let _liveThinkStarted = false;
      const _settleLiveWrite = (blocked) =>
        blocked ? _replOutputFlow.wait() : undefined;
      const liveOpts = _streamLive
        ? {
            onToken: (t) => {
              // Separate the answer from the dimmed reasoning above it (once).
              let blocked = false;
              if (!_liveStreamed && _liveThinkStarted) {
                blocked = process.stdout.write("\n") === false;
              }
              _liveStreamed = true;
              blocked = process.stdout.write(t) === false || blocked;
              return _settleLiveWrite(blocked);
            },
            onThinking: (t) => {
              if (process.env.CC_REPL_THINKING === "0") return;
              let blocked = false;
              if (!_liveThinkStarted) {
                process.stdout.write(chalk.dim("💭 "));
                _liveThinkStarted = true;
              }
              blocked = process.stdout.write(chalk.dim(t)) === false || blocked;
              return _settleLiveWrite(blocked);
            },
          }
        : {};
      if (_streamLive) process.stdout.write("\n");
      // Inject queued /note-next guidance into THIS turn just before
      // the model call. We remember the pre-aside content so it's restored right
      // after agentLoop returns — the aside steers this answer but is never
      // persisted (saveMessages/JSONL) or carried into later turns. Consumed on
      // send (cleared now) so a thrown turn doesn't re-inject next time; the
      // submit-start backstop restores if agentLoop throws before we get back.
      if (pendingBtw.length > 0) {
        const block = buildAsideBlock(pendingBtw);
        if (block) {
          _btwRestore = { msg: _userMsg, content: _userMsg.content };
          _userMsg.content = applyAside(_userMsg.content, block);
          logger.verbose(
            `[note-next] applied ${pendingBtw.length} note(s) to this turn`,
          );
        }
        pendingBtw = [];
      }
      // Consume the one-shot resume-degeneracy flag for THIS turn so the role
      // merge fires exactly once (2.1.187 parity; see _sanitizeRolesNextTurn).
      const _mergeRolesThisTurn = _sanitizeRolesNextTurn;
      _sanitizeRolesNextTurn = false;
      // Ensure the async-hook supervisor exists so `async:true` PostToolUse
      // hooks (fired inside the loop, per tool call) can be dispatched
      // fire-and-forget; their results/rewakes drain into the next turn above.
      if (_settingsHooks && !_asyncHookSupervisor) {
        const { AsyncHookSupervisor } =
          await import("../lib/async-hook-supervisor.js");
        _asyncHookSupervisor = new AsyncHookSupervisor({
          persistStats: true,
        });
      }
      const activeMcpRuntime = _activateMcpHostRuntime();
      const activeRawMcpClient = activeMcpRuntime.rawClient || undefined;
      const {
        content: response,
        usageEvents,
        thinking: reasoning,
      } = await agentLoop(messages, {
        ...liveOpts,
        waitForOutput: _replOutputFlow.wait,
        mergeRoles: _mergeRolesThisTurn,
        // Visible auto-retry feedback (Claude-Code 2.1.181): when the model's
        // streaming call hits a transient connection drop and retries, tell the
        // user instead of leaving them staring at a silent pause. To stderr so
        // it never corrupts the streamed answer on stdout.
        onStreamRetry: (attempt, error, telemetry = {}) => {
          process.stderr.write(
            chalk.dim(
              `  ⟳ connection dropped — retrying (attempt ${attempt})…\n`,
            ),
          );
          if (useJsonl && sessionId) {
            try {
              appendLlmRetryCompact(sessionId, {
                attempt,
                durationMs: telemetry.durationMs,
                provider: telemetry.provider || provider,
                model: telemetry.model || activeModel,
                reason: classifyStreamRetryReason(error),
              });
            } catch (persistenceError) {
              throw markRuntimeLedgerPersistenceError(persistenceError);
            }
          }
        },
        strictUsageTelemetry: useJsonl,
        // Stream-stall hint (Claude-Code 2.1.185): the connection is alive but
        // the API has gone silent mid-response — tell the user we're still
        // waiting instead of leaving a frozen spinner. stderr so it never
        // corrupts the streamed answer on stdout.
        onStall: (ms, timeoutMs) => {
          const silent = Math.round(ms / 1000);
          // 2.1.185: when a hard inactivity timeout is set, tell the user when
          // the stalled stream will auto-retry instead of leaving them unsure
          // whether it's hung forever.
          const retryIn =
            timeoutMs > ms ? Math.round((timeoutMs - ms) / 1000) : 0;
          const suffix = retryIn > 0 ? ` · will retry in ${retryIn}s` : "";
          process.stderr.write(
            chalk.dim(
              `  ⏳ waiting for API response (silent ${silent}s)${suffix}…\n`,
            ),
          );
        },
        // Hard inactivity timeout: abort + retry a dead-but-open stream instead
        // of hanging forever. undefined → agent-core's 180s default (matches cc
        // chat/ask); config.llm.streamStallTimeoutMs tunes or disables (0).
        streamStallTimeoutMs: _streamStallTimeoutMs,
        signal: combineReplSignals(_turnAbort.signal, options.signal),
        // On an auto-detected image turn, switch to the vision LLM for this
        // turn only (provider/baseUrl/apiKey unchanged, model → vision model).
        provider: _visionLlm ? _visionLlm.provider : provider,
        model: _visionLlm ? _visionLlm.model : activeModel,
        thinking: turnThinking,
        thinkingBudget,
        baseUrl: _visionLlm ? _visionLlm.baseUrl : baseUrl,
        apiKey: _visionLlm ? _visionLlm.apiKey : apiKey,
        contextEngine,
        iterationBudget,
        sessionId,
        persistUsageTelemetry: useJsonl,
        skillLoader: _replSkillLoader,
        cwd: process.cwd(),
        additionalDirectories,
        sandbox: _sandbox,
        autoCheckpoint,
        checkpointSession: sessionId,
        managedCheckpoint,
        managedCheckpointStateDir,
        managedCheckpointExclusions,
        checkpointMarks: _checkpointMarks,
        // Explicit turn-binding producer (null unless a JSONL session): the
        // wrapper folds every loop event into the live table.
        turnBindingFeed: _turnBindingProducer,
        // Non-MCP irreversible tools use the same prepare/start/settle ledger
        // and final lease assertion as headless, stream, and WebSocket hosts.
        sideEffects: _replSideEffects,
        denialLog: _recentDenials,
        persistRecentDenials: true,
        permissionMode: _sessionTier,
        // Seed the subagent-contract CEILING with the interactive session's
        // CURRENT approval tier (mapped back to a permission mode) so a spawned
        // sub-agent inherits/tightens from it (tighten-only), mirroring the
        // headless runner. An autopilot session hands children bypassPermissions
        // (→ allow confirmer); a mid-session Shift+Tab / `/permissions` change is
        // reflected because `_sessionTier` is read per turn. A strict session
        // resolves children to "default" exactly as before (byte-identical — the
        // previous absent ceiling also yielded "default").
        subAgentContract: {
          permissionMode: permissionModeForTier(_sessionTier),
        },
        prepareCall,
        approvalGate: _approvalGate,
        permissionRules: _permissionRules,
        permissionRulesProvider: _permissionRulesProvider,
        permissionConfirm: _permissionConfirm,
        settingsHooks: _settingsHooks,
        hookSupervisor: _asyncHookSupervisor,
        classifyAllShell: _classifyAllShell,
        // Interactive session: gate run_code through the ApprovalGate (like
        // run_shell) so a strict tier prompts before arbitrary code runs.
        interactiveApproval: true,
        // MCP: --mcp-config (ad-hoc) wins; bundle MCP is the fallback. The 3
        // tool channels expose --mcp-config servers' tools to the LLM directly.
        mcpClient: activeRawMcpClient,
        mcpHostClient: activeMcpRuntime.runtime.client,
        extraToolDefinitions: _adhocMcp?.extraToolDefinitions,
        externalToolExecutors: _adhocMcp?.externalToolExecutors,
        externalToolDescriptors: _adhocMcp?.externalToolDescriptors,
        // The recovery controller is required even when this legacy/ephemeral
        // session has no durable sink. Otherwise an outcome-unknown call could
        // be retried in the same process after agent-core creates a plain ledger.
        mcpCallLedger: activeMcpRuntime.runtime.ledger,
        mcpDispatchAdmission:
          useJsonl && _sessionHostLeaseScope ? _mcpDispatchAdmission : null,
        chatFn: _fallbackChatFn,
      });
      _persistReplContextSources();
      _turnAbort = null;

      // Strip one-shot /note-next guidance now the model has seen it so it is never
      // persisted (DB saveMessages below) or carried into the next turn.
      if (_btwRestore) {
        _btwRestore.msg.content = _btwRestore.content;
        _btwRestore = null;
      }

      // Running spend for `/cost` (in-memory, works without persistence).
      if (usageEvents?.length) addUsage(_costStore, usageEvents);

      // Feed the status line: the last usage event's input+output ≈ the tokens
      // now resident in the context window (what the next call resends). Track
      // the active model too, so the built-in readout reflects auto-switches.
      _curModel = activeModel;
      _turnCount += 1;
      if (usageEvents?.length) {
        const last = usageEvents[usageEvents.length - 1]?.usage || {};
        const used = (last.input_tokens || 0) + (last.output_tokens || 0);
        if (used > 0) _ctxUsedTokens = used;
      }

      // /goal (session completion condition): evaluate this turn's answer and
      // report met / not-yet / dropped. Deterministic conditions (exit-zero /
      // file-exists / contains / regex) run inline; a model condition reuses the
      // session model as an independent judge. Interactive → REPORT only, never
      // auto re-drive (that autonomous loop is headless-only). Best-effort — an
      // eval failure never disturbs the turn.
      if (_sessionGoal && !_sessionGoal.done) {
        try {
          const rg = await import("../lib/repl-goal.js");
          const fsMod = await import("node:fs");
          const judge = async (cond, { finalText }) => {
            const { chatWithTools } = await import("../runtime/agent-core.js");
            const { firstBalancedJson } =
              await import("../lib/json-schema-output.js");
            const p =
              `Judge whether this coding session met a completion condition.\n` +
              `Condition: ${cond.text || cond.source}\n\n` +
              `Latest assistant output:\n${String(finalText || "").slice(0, 2000)}\n\n` +
              `Reply with STRICT JSON only: {"met": true|false, "reason": "<short>"}.`;
            const jr = await _runReplMeteredModelCall({
              callProvider: provider,
              callModel: activeModel,
              source: "model",
              call: ({ signal }) =>
                chatWithTools([{ role: "user", content: p }], {
                  model: activeModel,
                  provider,
                  baseUrl,
                  apiKey,
                  signal,
                  enabledToolNames: [],
                }),
            });
            const text = jr?.message?.content || "";
            let met = false;
            let reason = "model judge returned no verdict";
            const block = firstBalancedJson(text, "{");
            if (block) {
              try {
                const parsed = JSON.parse(block);
                met = parsed.met === true;
                reason =
                  typeof parsed.reason === "string" && parsed.reason.trim()
                    ? parsed.reason.trim()
                    : met
                      ? "condition met"
                      : "condition not met";
              } catch {
                /* a non-JSON verdict stays unmet */
              }
            }
            return { met, reason, evidence: { kind: "model" } };
          };
          const { decision, events, done } = await rg.evaluateReplGoalTurn(
            _sessionGoal,
            response || "",
            {
              cwd: process.cwd(),
              existsSync: fsMod.existsSync,
              judge,
            },
          );
          for (const l of rg.renderGoalVerdict(decision, events))
            logger.log(chalk.cyan(l));
          if (done) _sessionGoal = null; // completed or exhausted → drop
        } catch (err) {
          const terminalError = _runtimeLedgerTerminalLatch.trip(err);
          if (terminalError) _reportRuntimeLedgerTerminal();
          else logger.verbose(`/goal eval skipped: ${err.message}`);
        }
      }

      // Fire AssistantResponse hook with rewrite/suppress support
      const responseDirective = await fireAssistantResponse(
        _hookDb,
        response || "",
        {
          sessionId,
          messageCount: messages.length,
          provider,
          model: activeModel,
        },
      );

      let effectiveResponse = response;
      if (responseDirective.suppress) {
        process.stdout.write(
          `\n[hook suppress] ${responseDirective.reason || "response suppressed"}\n\n`,
        );
        effectiveResponse = "";
      } else if (responseDirective.response !== (response || "")) {
        effectiveResponse = responseDirective.response;
      }

      // Extended-thinking reasoning (Anthropic, when /think is on): shown dimmed
      // BEFORE the answer. Not subject to the AssistantResponse rewrite/suppress
      // hook (that governs the answer text only). CC_REPL_THINKING=0 hides it.
      // In live mode it already streamed via onThinking, so skip the replay.
      if (reasoning && !_streamLive && process.env.CC_REPL_THINKING !== "0") {
        process.stdout.write(
          "\n" + chalk.dim("💭 " + reasoning.replace(/\n/g, "\n   ")) + "\n",
        );
      }

      if (effectiveResponse) {
        if (_streamLive && _liveStreamed) {
          // Already streamed live token-by-token during the turn (no
          // AssistantResponse hook to rewrite it) — just terminate + record.
          process.stdout.write("\n\n");
          messages.push({ role: "assistant", content: effectiveResponse });
        } else {
          // Phase G #2 — route through StreamRouter so REPL / WS / future
          // streaming providers share one StreamEvent protocol.
          const { streamAgentResponse } =
            await import("../lib/agent-stream.js");
          process.stdout.write("\n");
          const noStream = options.noStream === true;
          const streamResult = await streamAgentResponse(effectiveResponse, {
            noStream,
            writer: noStream ? null : (chunk) => process.stdout.write(chunk),
          });
          if (noStream) process.stdout.write(streamResult.text);
          process.stdout.write("\n\n");
          messages.push({ role: "assistant", content: streamResult.text });
        }
      } else if (!responseDirective.suppress) {
        // Claude-Code 2.1.183 parity: a turn that completes with no answer text
        // (model produced only extended-thinking blocks, or an empty response)
        // otherwise returned to the prompt silently — looking like a no-op/hang.
        // Surface a dim notice so the turn's completion is always visible.
        const notice = emptyTurnNotice({
          response: effectiveResponse,
          reasoning,
        });
        process.stdout.write(
          notice ? "\n" + chalk.dim("  " + notice) + "\n\n" : "\n",
        );
      }

      // Generate follow-up suggestions from the settled assistant turn. The
      // controller snapshots the actual conversation context and debounces in
      // the background, so readline and persistence remain non-blocking.
      const suggestionRun = _promptInteractions.scheduleSuggestions({
        messages: messages.slice(),
        lastAssistantText: effectiveResponse || "",
      });
      void suggestionRun.promise;

      // Auto-save session
      if (sessionId) {
        try {
          if (useJsonl) {
            // Append incremental events (user + assistant)
            appendUserMessage(sessionId, effectivePrompt);
            _replCompactPersistence.record({
              role: "user",
              content: effectivePrompt,
            });
            if (effectiveResponse) {
              appendAssistantMessage(sessionId, effectiveResponse);
              _replCompactPersistence.record({
                role: "assistant",
                content: effectiveResponse,
              });
            }
          } else if (db) {
            saveMessages(db, sessionId, messages);
          }
        } catch (_e) {
          // Non-critical
        }
      }
      // Persist the explicit turn-binding table for this settled turn,
      // including tool-free turns. A failure is Critical: the producer throws,
      // this turn reports an error, and the guard above blocks later turns.
      _turnBindingProducer?.persistIfDirty();
      // Auto-compact when context grows too large
      if (
        feature("PROMPT_COMPRESSOR") &&
        _compressor &&
        !_compactionUsageBlock &&
        !_runtimeLedgerTerminalLatch.isTripped() &&
        _compressor.shouldAutoCompact(messages)
      ) {
        try {
          const expectedMessages = [...messages];
          const {
            messages: compacted,
            stats,
            usageEvent,
            usageUnknownEvent,
          } = await compactConversationWithProvider(messages, {
            compressor: _compressor,
            preserveCompletedExchange: true,
            ..._compactOpts(messages),
          });
          const settlement = settleReplCompactionCandidate({
            messages,
            expectedMessages,
            compacted,
            stats,
            trigger: "auto",
            useJsonl,
            sessionId,
            persistence: _replCompactPersistence,
            usageEvent,
            usageUnknownEvent,
            costStore: _costStore,
          });
          if (settlement.usagePersistenceError) {
            const terminalError = _runtimeLedgerTerminalLatch.trip(
              settlement.usagePersistenceError,
            );
            if (terminalError) throw terminalError;
          }
          if (settlement.block) {
            _compactionUsageBlock = settlement.block;
            logger.error(
              `Auto-compaction usage is unknown (${settlement.block.code}); the paid compaction will not be retried.`,
            );
          } else if (!settlement.applied) {
            logger.warn(
              `Auto-compaction was not applied: ${settlement.error?.message || "canonical settlement failed"}`,
            );
          } else {
            recordCompressionMetric(stats, {
              source: "auto-compact",
              provider,
              model: activeModel,
            });
            if (stats.saved > 0) {
              logger.verbose(
                `Auto-compacted: ${stats.strategy} (saved ${stats.saved} tokens)`,
              );
              if (stats.degraded === true) {
                logger.warn(
                  `Auto-compaction degraded to ${stats.summaryMode}: ${stats.degradedReason}`,
                );
              }
            }
          }
        } catch (error) {
          if (
            isAbortError(error) ||
            _sessionHostLeaseScope?.lease?.signal?.aborted
          ) {
            throw error;
          }
          if (error?.runtimeLedgerPersistence === true) throw error;
          logger.warn(`Auto-compaction failed: ${error.message}`);
        }
      }

      // Store as episodic memory
      if (db) {
        try {
          storeMemory(db, promptText, { importance: 0.3, type: "episodic" });
        } catch (_e) {
          // Non-critical
        }
      }

      // settings.json Stop hooks (Claude-Code parity): the agent just finished a
      // turn. Sync Stop hooks observe; `async:true` Stop hooks fire-and-forget
      // (the canonical "run the test suite after the turn" trigger) with their
      // results/rewakes drained into the NEXT turn's context (see the async-hook
      // drain above). Best-effort — never break turn completion.
      if (_settingsHooks) {
        try {
          const { runObserveHooks, dispatchAsyncHooks } =
            await import("../lib/settings-hook-events.js");
          runObserveHooks(
            _settingsHooks,
            "Stop",
            { session_id: sessionId || null },
            { cwd: process.cwd() },
          );
          if (!_asyncHookSupervisor) {
            const { AsyncHookSupervisor } =
              await import("../lib/async-hook-supervisor.js");
            _asyncHookSupervisor = new AsyncHookSupervisor({
              persistStats: true,
            });
          }
          dispatchAsyncHooks(
            _settingsHooks,
            "Stop",
            {},
            { cwd: process.cwd(), supervisor: _asyncHookSupervisor },
          );
        } catch (_e) {
          // Stop-hook dispatch is best-effort
        }
      }
    } catch (err) {
      _turnAbort = null;
      const terminalError = _runtimeLedgerTerminalLatch.trip(err);
      if (terminalError) {
        _reportRuntimeLedgerTerminal();
        prompt();
        return;
      }
      // Esc interrupt: an aborted turn is normal flow, not an error — the
      // partial conversation stays usable and queued lines still drain.
      if (err?.name === "AbortError" || /abort/i.test(err?.message || "")) {
        logger.log(chalk.yellow("⎋ turn interrupted — partial progress kept"));
        prompt();
        return;
      }
      logger.error(`Error: ${err.message}`);

      // Record error for context injection
      if (contextEngine) {
        contextEngine.recordError({
          step: "agent-loop",
          message: err.message,
        });
      }

      // If connection error, provide helpful message
      if (
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("fetch failed")
      ) {
        logger.info(`Make sure ${provider} is running at ${baseUrl}`);
        if (provider === "ollama") {
          logger.info("Start Ollama: ollama serve");
        }
      }
    }

    prompt();
  };

  rl.on("line", async (input) => {
    if (!(await _waitForReplOutput())) return;
    if (_runtimeLedgerTerminalLatch.isTripped()) {
      const terminalInput = input.trim();
      if (terminalInput === "/exit" || terminalInput === "/quit") {
        logger.log(chalk.gray("\nGoodbye!"));
        rl.close();
      } else {
        _reportRuntimeLedgerTerminal();
      }
      return;
    }
    if (_processingLine) {
      const concurrentBtw = _slashCommandsDisabled
        ? null
        : parseBtwCommand(input.trim());
      if (concurrentBtw) {
        // Intentionally do not await: the main turn keeps streaming while this
        // independent, tool-free snapshot call runs alongside it.
        void runBtwSideQuestion(concurrentBtw, { concurrent: true });
        return;
      }
      if (input.trim()) {
        _pendingLines.push(input);
        logger.log(
          chalk.gray(
            `⏸ queued (${_pendingLines.length}) — runs after the current turn`,
          ),
        );
      }
      return;
    }
    _processingLine = true;
    try {
      await handleLine(input);
      if (!(await _waitForReplOutput())) return;
      while (_pendingLines.length && !_runtimeLedgerTerminalLatch.isTripped()) {
        const next = _pendingLines.shift();
        logger.log(chalk.cyan(`▶ running queued input: ${next}`));
        await handleLine(next);
        if (!(await _waitForReplOutput())) return;
      }
    } finally {
      _processingLine = false;
    }
  });

  rl.on("close", async () => {
    if (_replCleanupStarted) return;
    _replCleanupStarted = true;
    _replClosing = true;
    _promptInteractions.dispose();
    if (process.stdin.isTTY) {
      if (_replKeypressHandler) {
        process.stdin.removeListener("keypress", _replKeypressHandler);
      }
      for (const listener of _rlKeypressListeners) {
        process.stdin.removeListener("keypress", listener);
      }
    }
    // Leave the alternate screen buffer first so the terminal is restored to
    // the user's scrollback no matter how the REPL exits.
    if (_tuiMode === "fullscreen" && process.stdout.isTTY) {
      try {
        process.stdout.write(_ALT_LEAVE);
      } catch (_err) {
        // best-effort restore
      }
    }
    // Stop inbound channel listeners before anything else — no new external
    // events may enter a session that is shutting down.
    if (_channels) {
      try {
        _channels.stop();
      } catch (_err) {
        // best-effort
      }
      _channels = null;
    }
    // settings.json SessionEnd hooks (observe-only) when the REPL exits.
    if (_settingsHooks) {
      try {
        const { runObserveHooks } =
          await import("../lib/settings-hook-events.js");
        runObserveHooks(
          _settingsHooks,
          "SessionEnd",
          { reason: "exit", cwd: process.cwd(), session_id: sessionId },
          { cwd: process.cwd() },
        );
      } catch (_err) {
        // observe-only
      }
    }
    // Save session on exit
    if (sessionId) {
      try {
        if (useJsonl) {
          _persistReplContextSources();
          // JSONL: write final compact snapshot for fast rebuild
          _replCompactPersistence.persist(sessionId, {
            strategy: "session-end",
            messages,
          });
        } else if (db) {
          saveMessages(db, sessionId, messages);
        }
      } catch (_e) {
        logger.warn(`Session-end compact not persisted: ${_e.message}`);
      }
    }
    // Auto-summarize session into permanent memory
    if (permanentMemory && messages.length > 4) {
      try {
        permanentMemory.autoSummarize(messages);
      } catch (_e) {
        // Non-critical
      }
    }
    // Consolidate memory
    if (db) {
      try {
        consolidateMemory(db);
      } catch (_e) {
        // Non-critical
      }
    }
    // Fire SessionEnd hook before shutdown (fire-and-forget)
    await fireSessionHook(_hookDb, HookEvents.SessionEnd, {
      sessionId,
      messageCount: messages.length,
    });

    // Phase H — park the SessionManager handle on clean exit so the session
    // can be resumed later via `cc session unpark <id>`. `--no-park-on-exit`
    // opts out; a SIGINT path (process-level) will force close instead.
    if (_sessionMgr && sessionId) {
      try {
        if (options.parkOnExit === false) {
          await _sessionMgr.close(sessionId);
        } else {
          _sessionMgr.markIdle(sessionId);
          await _sessionMgr.park(sessionId);
          logger.log(
            chalk.gray(
              `Session ${sessionId.slice(0, 12)} parked — resume with: cc session unpark ${sessionId}`,
            ),
          );
        }
      } catch (_e) {
        // Non-critical — parking failure must not block shutdown
      }
    }

    // Disconnect bundle MCP servers
    if (_bundleMcpClient) {
      try {
        await _bundleMcpClient.disconnectAll();
      } catch (_e) {
        // Non-critical
      }
    }

    // Disconnect ad-hoc (--mcp-config) MCP servers
    if (_adhocMcp?.mcpClient) {
      try {
        await _adhocMcp.mcpClient.disconnectAll();
      } catch (_e) {
        // Non-critical
      }
    }

    // Tear down /remote-control (bridge + its self-hosted WS server) so the
    // pairing endpoint doesn't outlive the session.
    if (_remoteApproval) {
      try {
        await _stopRemoteApproval();
      } catch (_e) {
        // Non-critical
      }
    }

    // Kill any background run_shell tasks so a backgrounded command (e.g. a
    // dev server) doesn't outlive the REPL session.
    try {
      killAllBackgroundShellTasks();
    } catch (_e) {
      // Non-critical
    }

    // Reap plugin background monitors (Phase 3.3i) — clear interval timers and
    // SIGTERM every watcher child so no monitor process outlives the session.
    if (_pluginMonitors) {
      try {
        _pluginMonitors.stopAll();
      } catch (_e) {
        // Non-critical
      }
      _pluginMonitors = null;
    }

    // Reap async settings-hook processes (Phase 6) — SIGTERM any fire-and-forget
    // `async:true` hook still running so none outlives the session.
    if (_asyncHookSupervisor) {
      try {
        _asyncHookSupervisor.stopAll();
      } catch (_e) {
        // Non-critical
      }
      _asyncHookSupervisor = null;
    }

    // Restore PATH — drop the plugin bin dirs added at startup (Phase 3.3n).
    if (_pluginBinRestore) {
      try {
        _pluginBinRestore();
      } catch (_e) {
        // Non-critical
      }
      _pluginBinRestore = null;
    }

    // Drop plugin-provided default env vars added at startup (Phase 3.3o).
    if (_pluginSettingsRestore) {
      try {
        _pluginSettingsRestore();
      } catch (_e) {
        // Non-critical
      }
      _pluginSettingsRestore = null;
    }

    // Shutdown runtime
    _detachSessionBudget();
    try {
      await closeReplSessionBudgetRootScope(_sessionBudgetRootScope);
    } catch (error) {
      _replOutputFailure ||= error;
    }
    _detachSessionHostLease();
    try {
      releaseReplSessionHostLeaseScope(_sessionHostLeaseScope);
    } catch (error) {
      _replOutputFailure ||= error;
    }
    try {
      await shutdown();
    } catch (_e) {
      // Non-critical
    }
    if (!_replOutputFailure) {
      try {
        await _replOutputFlow.wait();
      } catch (error) {
        _replOutputFailure ||= error;
      }
    }
    const outputExitCode = _replOutputFailure
      ? _replOutputFailure.code === "EPIPE"
        ? 0
        : 1
      : 0;
    outputScope.restore();
    process.exit(outputExitCode);
  });
  _replCloseReady = true;
  if (_replClosing) {
    // stdout may have broken before readline and its cleanup handler were fully
    // initialized. Close only now so the complete async teardown runs.
    queueMicrotask(() => {
      try {
        rl.close();
      } catch {
        process.exitCode = 0;
      }
    });
  }
}
