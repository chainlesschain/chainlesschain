/**
 * Headless agent runner — Claude-Code `claude -p` parity for `cc agent`.
 *
 * Runs ONE non-interactive agentic turn (the agent may still take many internal
 * tool-loop iterations) and emits the result in a machine-consumable format.
 * Unlike startAgentRepl, there is no readline loop — input arrives via the
 * `prompt` option (flag / positional / piped stdin) and the process exits when
 * the loop completes.
 *
 * Output formats (mirrors `claude -p --output-format`):
 *  - text         : final assistant text only → stdout; tool trace → stderr
 *  - json         : a single result envelope (one JSON object) → stdout
 *  - stream-json   : one JSON event per line (NDJSON) → stdout, as they happen
 *
 * Permission model: headless cannot show an interactive approval prompt, so the
 * default is fail-closed (deny MEDIUM/HIGH-risk shell). --permission-mode opts
 * into a looser tier:
 *  - (default) / manual / dontAsk / plan → STRICT + deny-confirmer
 *    (plan also restricts tools)
 *  - auto / acceptEdits                  → TRUSTED + deny-confirmer
 *    (HIGH-risk shell still denied)
 *  - bypassPermissions                   → AUTOPILOT (everything allowed)
 */

import { randomUUID } from "node:crypto";
import { bootstrap } from "./bootstrap.js";
import {
  buildSystemPrompt,
  agentLoop as coreAgentLoop,
  formatToolArgs,
  killAllBackgroundShellTasks,
  killAllBackgroundShellTasksSync,
  normalizeExactFileMutationScope,
} from "./agent-core.js";
import {
  resolveAgentMcp,
  resolvePermissionPromptTool,
  makePermissionPromptConfirmer,
} from "./mcp-config.js";
import { maybeApplyToolSearch } from "./mcp-tool-search.js";
import { IterationBudget } from "../lib/iteration-budget.js";
import { HostResourceBudget } from "../lib/host-resource-budget.js";
import {
  FORMAL_QUALITY_FILE_TOOLS,
  isFormalQualityHermeticRuntime,
} from "../lib/formal-quality-eval-runtime.js";
import {
  startSession as jsonlStartSession,
  appendUserMessage as jsonlAppendUserMessage,
  appendAssistantMessage as jsonlAppendAssistantMessage,
  appendTokenUsage as jsonlAppendTokenUsage,
  appendToolCallCompact as jsonlAppendToolCallCompact,
  appendLlmRetryCompact as jsonlAppendLlmRetryCompact,
  appendCompactEvent as jsonlAppendCompactEvent,
  appendEvent as jsonlAppendEvent,
  appendAuthorityEvent as jsonlAppendAuthorityEvent,
  readEvents as jsonlReadEvents,
  readVerifiedEvents as jsonlReadVerifiedEvents,
  findLatestEvent as jsonlFindLatestEvent,
  rebuildMessages as jsonlRebuildMessages,
  sessionExists as jsonlSessionExists,
  sessionHasPersistedEvidence as jsonlSessionHasPersistedEvidence,
  resolveSessionAuthority as jsonlResolveSessionAuthority,
  getLastSessionId as jsonlGetLastSessionId,
  verifySession as jsonlVerifySession,
} from "../harness/jsonl-session-store.js";
import { classifyStreamRetryReason } from "../lib/stream-retry.js";
import {
  SideEffectLedger,
  reconcileSideEffects,
  classifyToolSideEffect,
} from "../lib/side-effect-ledger.js";
import { collectToolResourceIdentifiers } from "../lib/permission-side-effect-center.js";
import { DiffReviewFollowUpTracker } from "../lib/diff-review-follow-up.js";
import { SIDE_EFFECT_LEDGER_EVENT } from "../lib/side-effect-ledger-store.js";
import {
  createSessionMcpLedgerSink,
  formatMcpLedgerRecoveryNotice,
  loadMcpLedgerRecovery,
} from "../lib/mcp-call-ledger-store.js";
import { createMcpHostRecoveryRuntime } from "../lib/mcp-host-recovery-runtime.js";
import { readSessionHostResumeState } from "../lib/session-host-snapshot.js";
import {
  acquireSessionHostLease,
  createSessionHostWriteDelegation,
} from "../lib/session-host-lease.js";
import { TurnBindingLog, createTurnBindingFeed } from "../lib/turn-binding.js";
import { TURN_BINDING_EVENT } from "../lib/turn-binding-store.js";
import { operationIdempotencyKey } from "../lib/idempotency.js";
import {
  addHooksV2EventObserver,
  emitHooksV2Event,
  executeHooksV2Event,
  resolvePromptExpansion,
} from "../lib/hooks-v2-producers.js";
import {
  projectHookPolicyDecision,
  projectToolPolicyDecision,
} from "../lib/policy-decision-event.js";
import { runWithHostHooksV2Workspace } from "../lib/hooks-v2-workspace-context.js";
import { CLISkillLoader } from "../lib/skill-loader.js";
import { expandFileRefsAsync } from "./file-ref-expander.js";
import { composeSystemPrompt } from "./system-prompt.js";
import { buildUserContent } from "../lib/image-input.js";
import { mergeConsecutiveMessages } from "./message-roles.js";
import { isHeadlessConfigCommand } from "../lib/headless-config-command.js";
import {
  STREAM_PROTOCOL_VERSION,
  computePolicyDigest,
  computeToolsHash,
  buildLoadedSources,
} from "../lib/headless-manifest.js";
import {
  HEADLESS_EXIT_CODES,
  classifyLoopError,
  exitCodeForEndReason,
} from "../lib/exit-codes.cjs";
import { isolationLevel } from "../lib/agent-sandbox.js";
import { captureAmbientExecutionLocation } from "../lib/execution-location-runtime.js";
import { createBackgroundPhaseReporter } from "../lib/background-phase-reporter.js";
import { createBackgroundInteractionClient } from "../lib/background-interaction-resolver.js";
import { withQuietStdout } from "./quiet-stdout.js";
import { captureAgentEvolutionIngress } from "../lib/evolution/agent-evolution-ingress.js";
import { captureAgentSkillOutcomeIndex } from "../lib/evolution/agent-evolution-runtime-composition-brand.js";
import { captureSkillVectorAuthority } from "../lib/skill-vector-authority.js";
import { captureSkillRetrievalRevocationReader } from "../lib/evolution/skill-retrieval-revocation-authority.js";
import { CostBudget } from "../lib/cost-budget.js";
import { estimateTokens } from "../harness/prompt-compressor.js";
import {
  classifyDenial,
  recordDenial,
  formatDenials,
} from "../lib/repl-denials.js";
import executionBroker from "../lib/process-execution-broker/index.js";
import { extractPluginUsageAttribution } from "../lib/plugin-usage-attribution.js";
import { formatManagedCheckpointEvent } from "../lib/managed-checkpoint-render.js";
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

const goalBrokerRunner = executionBroker.spawnSync.bind(executionBroker);

export const _goalProcessDeps = {
  run: goalBrokerRunner,
};

export const RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE =
  "CC_RUNTIME_USAGE_LEDGER_FAILED: runtime usage telemetry was not durably persisted";

export function resolveHeadlessMeteredSessionId(persist, sessionId) {
  return persist && sessionId ? sessionId : null;
}

function runHeadlessGoalCommand(command, options = {}) {
  return _goalProcessDeps.run(command, [], {
    ...options,
    timeout: options.timeout ?? 30000,
    origin: "headless-goal:exit-zero",
    policy: "allow",
    scope: "headless-goal",
  });
}

/** Tools that cannot mutate the filesystem or run commands. */
export const READ_ONLY_TOOLS = Object.freeze([
  "read_file",
  "search_files",
  "list_dir",
  "list_skills",
  "search_sessions",
]);

const VALID_PERMISSION_MODES = Object.freeze([
  "default",
  "manual",
  "auto",
  "dontAsk",
  "plan",
  "acceptEdits",
  "bypassPermissions",
]);

const VALID_OUTPUT_FORMATS = Object.freeze(["text", "json", "stream-json"]);
const HERMETIC_SKILL_LOADER = Object.freeze({
  getAutoActivatedPersonas: () => [],
  getResolvedSkills: () => [],
  getCacheLedger: () => null,
  getLimits: () => null,
});
// EPIPE guard for `cc agent -p … | head`. Lives in pipe-safety.js (shared with
// the stream-json driver + REPL); re-exported here for existing importers.
export { installPipeSafety } from "./pipe-safety.js";
import { installPipeSafety } from "./pipe-safety.js";
import { createHeadlessOutputBackpressure } from "./output-backpressure.js";
import {
  cleanupDeadlineError,
  createCleanupDeadline,
} from "./cleanup-deadline.js";
import {
  createSessionPersistenceFailure,
  projectSessionPersistenceFailure,
} from "../lib/session-persistence-failure.js";
import {
  markRuntimeLedgerPersistenceError,
  projectRuntimeTokenUsage,
  projectRuntimeUsageBoundary,
  runtimeUsageEventType,
  runtimeToolCallId,
} from "../lib/runtime-usage-ledger.js";
import { runMeteredDirectModelCall } from "../lib/direct-model-usage.js";
import { resolveTeamMessageToolBundle } from "../lib/agent-team/team-message-tools.js";

/**
 * Normalize a public --permission-mode spelling to the canonical internal mode.
 *
 * @param {string} [mode]
 * @returns {string}
 */
export function normalizePermissionMode(mode = "default") {
  const m = mode || "default";
  if (!VALID_PERMISSION_MODES.includes(m)) {
    throw new Error(
      `Invalid --permission-mode "${m}". Expected one of: ${VALID_PERMISSION_MODES.join(", ")}`,
    );
  }
  return m;
}

/**
 * Resolve a --permission-mode string into the session-policy tier + a
 * non-interactive confirmer + whether to clamp tools to the read-only set.
 *
 * @param {string} mode
 * @returns {{ sessionPolicy: string, confirmer: (ctx:any)=>Promise<boolean>, readOnly: boolean, allowInteractiveApprovals: boolean }}
 */
export function resolvePermissionMode(mode = "default") {
  const m = normalizePermissionMode(mode);
  // Headless can't ask a human — deny when a confirm would be required.
  const denyConfirmer = async () => false;
  const allowConfirmer = async () => true;
  switch (m) {
    case "bypassPermissions":
      return {
        sessionPolicy: "autopilot",
        confirmer: allowConfirmer,
        readOnly: false,
        allowInteractiveApprovals: false,
      };
    case "auto":
    case "acceptEdits":
      return {
        sessionPolicy: "trusted",
        confirmer: denyConfirmer,
        readOnly: false,
        allowInteractiveApprovals: true,
      };
    case "plan":
      return {
        sessionPolicy: "strict",
        confirmer: denyConfirmer,
        readOnly: true,
        allowInteractiveApprovals: true,
      };
    case "dontAsk":
      return {
        sessionPolicy: "strict",
        confirmer: denyConfirmer,
        readOnly: false,
        allowInteractiveApprovals: false,
      };
    case "manual":
    case "default":
    default:
      return {
        sessionPolicy: "strict",
        confirmer: denyConfirmer,
        readOnly: false,
        allowInteractiveApprovals: true,
      };
  }
}

/**
 * Compute the effective tool allow-list. --allowed-tools wins; when plan mode
 * forces read-only we intersect with READ_ONLY_TOOLS so a user can't widen it.
 *
 * @returns {string[]|null} null = all tools (subject to disabledTools)
 */
export function resolveEnabledTools({ allowedTools, readOnly } = {}) {
  let names =
    Array.isArray(allowedTools) && allowedTools.length > 0
      ? [...allowedTools]
      : null;
  if (readOnly) {
    names = names
      ? names.filter((n) => READ_ONLY_TOOLS.includes(n))
      : [...READ_ONLY_TOOLS];
  }
  return names;
}

/** Normalize a comma/space separated CLI list into a string[] (or null). */
export function parseToolList(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.flatMap((v) => parseToolList(v) || []);
  const out = String(value)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length > 0 ? out : null;
}

/**
 * Resolve the working session id, the id to resume history from, and whether to
 * persist this turn — mirroring `claude -p --resume <id>` / `--continue`.
 *
 *  - continueSession (or --resume with no id) → resume the most-recent session
 *  - resume "<id>"                            → resume that specific session
 *      (the id need not exist yet — it then doubles as "create + persist here",
 *       so a later `--resume <id>` picks the conversation back up)
 *
 * Persistence is intentionally OFF unless a resume/continue/persist intent is
 * present, so a plain one-shot `cc agent -p "..."` writes nothing to disk.
 *
 * `--ephemeral` forces persistence OFF regardless of the above: a resume id
 * still REPLAYS prior history into context, but nothing new is written — the
 * deterministic-CI shape ("read context, leave no trace").
 *
 * @param {object} options { resume, continueSession, sessionId, persistSession, ephemeral, observabilityScope }
 * @param {object} store   { getLastSessionId }  (injection seam)
 * @param {string} fallbackId  used when nothing is being resumed
 * @returns {{ sessionId:string, resumeId:string|null, persist:boolean, wantLatest:boolean }}
 */
export function resolveHeadlessSession(options = {}, store = {}, fallbackId) {
  const {
    resume,
    continueSession,
    sessionId,
    persistSession,
    ephemeral,
    observabilityScope,
  } = options;
  const wantLatest = continueSession === true || resume === true;
  let resumeId = null;
  if (wantLatest) {
    resumeId =
      (typeof store.getLastSessionId === "function" &&
        store.getLastSessionId()) ||
      null;
  } else if (typeof resume === "string" && resume.trim()) {
    resumeId = resume.trim();
  }
  if (resumeId && typeof store.resolveSessionAuthority === "function") {
    const authority = store.resolveSessionAuthority(resumeId);
    if (authority && !authority.readable) {
      const error = new Error(
        `Canonical session ${authority.id} is not resumable (${authority.presence})`,
      );
      error.code = "SESSION_CANONICAL_UNAVAILABLE";
      error.sessionId = authority.id;
      error.presence = authority.presence;
      throw error;
    }
    if (authority?.id) resumeId = authority.id;
  }
  const persist =
    ephemeral === true
      ? false
      : persistSession === true ||
        resumeId != null ||
        wantLatest ||
        observabilityScope != null;
  const id = resumeId || sessionId || fallbackId;
  return { sessionId: id, resumeId, persist, wantLatest };
}

/**
 * Apply `--fork-session`: when a session has been resolved (resume/continue) and
 * a fork is requested, branch its JSONL transcript into a NEW id so the original
 * stays untouched (Claude-Code `--fork-session` parity). The copy carries the
 * full prior history, so a later `--resume <newId>` replays the whole branch.
 *
 * Returns the id to use downstream + the source (`forkedFrom`), or the original
 * id unchanged with `missing:true` when there is no transcript to fork. Pure
 * apart from the injected store's side effect; both `sessionExists`/`forkSession`
 * are injection seams so this is unit-testable without disk.
 *
 * @param {{forkSession?:boolean, sessionId?:string|null, forkRequestId?:string}} opts
 * @param {{sessionExists?:Function, forkSession?:Function}} store
 * @returns {{ sessionId:string|null, forkedFrom:string|null, missing:boolean }}
 */
export function applyForkSession(opts = {}, store = {}) {
  const want = opts.forkSession === true;
  const id = opts.sessionId || null;
  if (!want || !id) return { sessionId: id, forkedFrom: null, missing: false };
  if (typeof store.sessionExists === "function" && !store.sessionExists(id)) {
    return { sessionId: id, forkedFrom: null, missing: true };
  }
  const requestId =
    typeof opts.forkRequestId === "string" && opts.forkRequestId.length > 0
      ? opts.forkRequestId
      : `cli-${randomUUID()}`;
  const newId =
    typeof store.forkSession === "function"
      ? store.forkSession(id, { requestId })
      : null;
  if (!newId) return { sessionId: id, forkedFrom: null, missing: false };
  return { sessionId: newId, forkedFrom: id, missing: false };
}

/**
 * Run a single headless agentic turn.
 *
 * @param {object} options
 * @param {string} options.prompt              The task/prompt (required).
 * @param {string} [options.model]
 * @param {string} [options.provider]
 * @param {string} [options.baseUrl]
 * @param {string} [options.apiKey]
 * @param {string} [options.outputFormat="text"]
 * @param {string} [options.permissionMode="default"]
 * @param {string[]} [options.allowedTools]
 * @param {string[]} [options.disallowedTools]
 * @param {number} [options.maxTurns]          Cap on agent loop iterations.
 * @param {string} [options.cwd]               Trusted CLI-host workspace
 *                                             input. Never populate this from
 *                                             model/plugin/hook/event payloads.
 * @param {string[]} [options.additionalDirectories] Extra workspace roots
 *                                             (--add-dir): absolute dirs the
 *                                             agent may read/search/edit.
 * @param {string|boolean} [options.resume]    Resume a session: "<id>", or true
 *                                             (no id) → most-recent session.
 * @param {boolean} [options.continueSession]  Resume the most-recent session.
 * @param {boolean} [options.persistSession]   Force persistence without resume.
 * @param {boolean} [options.autoCheckpoint]   Snapshot the work tree before each
 *                                             mutating tool (git engine only).
 * @param {boolean} [options.expandFileRefs=true] Expand `@path` file references
 *                                             in the prompt into context blocks.
 * @param {object} [deps]                       Injection seam for tests.
 * @returns {Promise<{ exitCode:number, result:string, isError:boolean, sessionSnapshot?:object }>}
 */
const HEADLESS_SESSION_RESOLUTION = Symbol("headlessSessionResolution");
const HEADLESS_SESSION_HOST_LEASE = Symbol("headlessSessionHostLease");
const HEADLESS_HOOK_EVENT_CLEANUP = Symbol("headlessHookEventCleanup");
const HOST_EVENT_BACKLOG_CODE = "CC_HOST_EVENT_BACKLOG_EXHAUSTED";
const HOST_EVENT_BACKLOG_ERROR =
  "CC_HOST_EVENT_BACKLOG_EXHAUSTED: event backlog limit reached";

async function withHeadlessSessionHostLease(options, deps, task) {
  const prompt = (options.prompt || "").trim();
  if (!prompt) {
    throw new Error(
      "runAgentHeadless requires a non-empty prompt (use -p, a positional arg, or pipe stdin).",
    );
  }
  if (options.observabilityScope != null && options.ephemeral === true) {
    throw new Error(
      "observability scope requires durable session persistence and cannot be combined with ephemeral mode",
    );
  }
  const outputFormat = options.outputFormat || "text";
  if (!VALID_OUTPUT_FORMATS.includes(outputFormat)) {
    throw new Error(
      `Invalid --output-format "${outputFormat}". Expected one of: ${VALID_OUTPUT_FORMATS.join(", ")}`,
    );
  }
  let resolution = null;
  let lease = null;
  let budgetRoot = null;
  let scopedOptions = options;
  try {
    // Session authority/lease/budget setup can lazily initialize AppConfig and
    // DatabaseManager. Those legacy diagnostics use console.info (stdout), and
    // therefore used to precede the first NDJSON event for a persisted
    // `--output-format stream-json` run. Keep the task itself outside this
    // scope so only bootstrap chatter is redirected, never protocol payloads.
    await withQuietStdout(() => {
      const hasInjectedSessionStore =
        typeof deps.sessionHasPersistedEvidence === "function" ||
        typeof deps.sessionExists === "function" ||
        typeof deps.rebuildMessages === "function" ||
        typeof deps.appendEvent === "function" ||
        typeof deps.appendAuthorityEvent === "function" ||
        typeof deps.readVerifiedEvents === "function";
      resolution = resolveHeadlessSession(
        options,
        {
          getLastSessionId: deps.getLastSessionId || jsonlGetLastSessionId,
          resolveSessionAuthority:
            deps.resolveSessionAuthority ||
            (!hasInjectedSessionStore
              ? jsonlResolveSessionAuthority
              : undefined),
        },
        `headless-${Date.now()}-${process.pid}`,
      );
      const authoritySessionId =
        resolution.resumeId ||
        (resolution.persist ? resolution.sessionId : null);
      const acquireHostLease =
        deps.acquireSessionHostLease ||
        (!hasInjectedSessionStore ? acquireSessionHostLease : null);
      if (authoritySessionId && typeof acquireHostLease === "function") {
        lease = acquireHostLease(authoritySessionId, {
          hostKind: "headless",
        });
      }
      scopedOptions = lease?.signal
        ? {
            ...options,
            signal: options.signal
              ? AbortSignal.any([options.signal, lease.signal])
              : lease.signal,
          }
        : options;
      budgetRoot = openProductionSessionBudgetRoot(
        authoritySessionId,
        options.sessionBudgetRoot,
        {
          persist: resolution.persist,
          signal: scopedOptions.signal || null,
          table: options.sessionBudgetRoot?.table,
          open: deps.openSessionBudget,
          store: deps.sessionBudgetStore,
          registry: deps.sessionBudgetRegistry,
        },
      );
      if (budgetRoot.enabled) {
        scopedOptions = { ...scopedOptions, ...budgetRoot.options };
      }
    });
    return await task(scopedOptions, {
      ...deps,
      [HEADLESS_SESSION_RESOLUTION]: resolution,
      [HEADLESS_SESSION_HOST_LEASE]: lease,
    });
  } finally {
    // Cleanup can touch the same lazy stores. Keep late diagnostics out of a
    // completed JSON/NDJSON payload while preserving release-on-close failure.
    await withQuietStdout(() => {
      try {
        budgetRoot?.close?.();
      } finally {
        lease?.release?.();
      }
    });
  }
}

export async function runAgentHeadless(options = {}, deps = {}) {
  const trustedWorkspaceRoot = options.cwd || process.cwd();
  const pipeState = { closed: false };
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const shouldInstallPipeSafety =
    typeof deps.installPipeSafety === "function" ||
    (!deps.writeOut && !deps.writeErr);
  const pipeAbort = shouldInstallPipeSafety ? new AbortController() : null;
  const managesNativeOutput = !deps.writeOut || !deps.writeErr;
  const outputAbort = managesNativeOutput ? new AbortController() : null;
  const handlePipeClosed = () => {
    if (pipeState.closed) return;
    pipeState.closed = true;
    process.exitCode = 0;
    pipeAbort?.abort();
  };
  const outputFlow =
    deps.outputFlow ||
    createHeadlessOutputBackpressure({
      stdout,
      stderr,
      writeOut: deps.writeOut,
      writeErr: deps.writeErr,
      maxQueuedBytes: deps.outputBackpressureMaxBytes,
      drainTimeoutMs: deps.outputBackpressureTimeoutMs,
      onFailure: (error) => {
        outputAbort?.abort(error);
        if (error?.code === "EPIPE") handlePipeClosed();
      },
    });
  const abortSignals = [
    options.signal,
    pipeAbort?.signal,
    outputAbort?.signal,
  ].filter(Boolean);
  const runtimeOptions =
    abortSignals.length === 0
      ? options
      : {
          ...options,
          signal:
            abortSignals.length === 1
              ? abortSignals[0]
              : AbortSignal.any(abortSignals),
        };
  // The inner runner can return before its long-lived cleanup `finally` is
  // installed. Keep its pre-manifest hook queue disposer in this shared scope
  // so the top-level host still releases every event slot on any early throw.
  const hookEventCleanup = { dispose: null };
  const runtimeDeps = {
    ...deps,
    writeOut: outputFlow.writeOut,
    writeErr: outputFlow.writeErr,
    outputFlow,
    [HEADLESS_HOOK_EVENT_CLEANUP]: hookEventCleanup,
  };
  const installSafety = deps.installPipeSafety || installPipeSafety;
  const disposePipeSafety = shouldInstallPipeSafety
    ? installSafety([stdout, stderr], handlePipeClosed)
    : null;

  let outcome;
  let failure = null;
  try {
    outcome = await runWithHostHooksV2Workspace(trustedWorkspaceRoot, () =>
      withHeadlessSessionHostLease(
        runtimeOptions,
        runtimeDeps,
        (scopedOptions, scopedDeps) =>
          runAgentHeadlessInWorkspace(scopedOptions, scopedDeps, pipeState),
      ),
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      hookEventCleanup.dispose?.();
    } catch {
      // Queue-slot cleanup is best-effort and must not replace the run error.
    }
    try {
      await outputFlow.wait();
    } catch (error) {
      failure ||= error;
    }
    outputFlow.dispose();
    disposePipeSafety?.();
  }

  if (pipeState.closed) {
    return outcome
      ? { ...outcome, exitCode: 0, isError: false }
      : { exitCode: 0, result: "", isError: false };
  }
  if (failure) throw failure;
  return outcome;
}

async function runAgentHeadlessInWorkspace(
  options = {},
  deps = {},
  pipeState = { closed: false },
) {
  const evolutionIngress =
    options.evolutionIngress == null
      ? null
      : captureAgentEvolutionIngress(options.evolutionIngress);
  const skillOutcomeIndex =
    options.skillOutcomeIndex == null
      ? null
      : captureAgentSkillOutcomeIndex(options.skillOutcomeIndex);
  const skillVectorAuthority =
    options.skillVectorAuthority == null
      ? null
      : captureSkillVectorAuthority(options.skillVectorAuthority);
  const skillRetrievalRevocationReader =
    options.skillRetrievalRevocationReader == null
      ? null
      : captureSkillRetrievalRevocationReader(
          options.skillRetrievalRevocationReader,
        );
  if (
    evolutionIngress !== null &&
    skillOutcomeIndex !== null &&
    evolutionIngress.tenantId !== skillOutcomeIndex.tenantId
  ) {
    throw new TypeError(
      "Agent evolution ingress and Skill outcome index must share one tenant",
    );
  }
  const retrievalTenant =
    evolutionIngress?.tenantId ?? skillOutcomeIndex?.tenantId ?? null;
  if (
    retrievalTenant !== null &&
    skillVectorAuthority !== null &&
    retrievalTenant !== skillVectorAuthority.tenantId
  ) {
    throw new TypeError("Agent retrieval authorities must share one tenant");
  }
  if (
    skillVectorAuthority !== null &&
    skillRetrievalRevocationReader !== null &&
    skillVectorAuthority.tenantId !== skillRetrievalRevocationReader.tenantId
  ) {
    throw new TypeError("Agent retrieval authorities must share one tenant");
  }
  if (
    retrievalTenant !== null &&
    skillRetrievalRevocationReader !== null &&
    retrievalTenant !== skillRetrievalRevocationReader.tenantId
  ) {
    throw new TypeError("Agent retrieval authorities must share one tenant");
  }
  const prompt = (options.prompt || "").trim();
  if (!prompt) {
    throw new Error(
      "runAgentHeadless requires a non-empty prompt (use -p, a positional arg, or pipe stdin).",
    );
  }

  const outputFormat = options.outputFormat || "text";
  if (!VALID_OUTPUT_FORMATS.includes(outputFormat)) {
    throw new Error(
      `Invalid --output-format "${outputFormat}". Expected one of: ${VALID_OUTPUT_FORMATS.join(", ")}`,
    );
  }

  const isStream = outputFormat === "stream-json";
  const isJson = outputFormat === "json";
  const isText = outputFormat === "text";
  const writeOut = deps.writeOut;
  const writeErr = deps.writeErr;
  const cleanupDeadline = createCleanupDeadline({
    timeoutMs: deps.cleanupDeadlineMs,
    label: "headless-runner-cleanup",
  });

  const hasInjectedSessionStore =
    typeof deps.sessionHasPersistedEvidence === "function" ||
    typeof deps.sessionExists === "function" ||
    typeof deps.rebuildMessages === "function" ||
    typeof deps.appendEvent === "function" ||
    typeof deps.appendAuthorityEvent === "function" ||
    typeof deps.readVerifiedEvents === "function";
  const { sessionId, resumeId, persist } =
    deps[HEADLESS_SESSION_RESOLUTION] ||
    resolveHeadlessSession(
      options,
      {
        getLastSessionId: deps.getLastSessionId || jsonlGetLastSessionId,
        resolveSessionAuthority:
          deps.resolveSessionAuthority ||
          (!hasInjectedSessionStore ? jsonlResolveSessionAuthority : undefined),
      },
      `headless-${Date.now()}-${process.pid}`,
    );
  if (evolutionIngress !== null) {
    await evolutionIngress.start();
    await evolutionIngress.ingestUserPrompt({
      content: prompt,
      sessionId,
      source: "headless",
    });
  }
  const sessionHostLease = deps[HEADLESS_SESSION_HOST_LEASE] || null;
  const includeHookEvents = isStream && options.includeHookEvents === true;
  // One headless invocation owns one bounded queue/cache authority. Keep an
  // injected authority intact so an embedding can share it with its host.
  // Do not wire sessionBudget here: executeTool already owns that lease.
  const hostResourceBudget =
    options.hostResourceBudget || new HostResourceBudget();
  const pendingHookEvents = [];
  let writeHookEvent = null;
  let removeHookObserver = null;
  let hookEventBacklogExhausted = false;
  let hookEventQueueDisposed = false;
  const disposePendingHookEvents = () => {
    if (hookEventQueueDisposed) return;
    hookEventQueueDisposed = true;
    try {
      removeHookObserver?.();
    } finally {
      removeHookObserver = null;
      while (pendingHookEvents.length > 0) {
        const queued = pendingHookEvents.shift();
        try {
          queued?.lease?.release?.();
        } catch {
          // Budget slots are idempotent, but injected authorities may throw
          // during teardown. Continue draining every remaining slot.
        }
      }
    }
  };
  const queuePendingHookEvent = (event) => {
    if (hookEventQueueDisposed || hookEventBacklogExhausted) return;
    if (writeHookEvent) {
      writeHookEvent(event);
      return;
    }
    try {
      if (typeof hostResourceBudget?.admitEvent !== "function") {
        throw new TypeError(
          "host resource budget does not provide admitEvent()",
        );
      }
      const lease = hostResourceBudget.admitEvent();
      if (!lease || typeof lease.release !== "function") {
        throw new TypeError("host resource budget event admission is invalid");
      }
      pendingHookEvents.push({ event, lease });
    } catch {
      // Hook lifecycle projection is diagnostic-only, but retaining arbitrary
      // events before the manifest is ready is not. Stop observing and fail the
      // run at the next safe protocol boundary without exposing hook/input data.
      hookEventBacklogExhausted = true;
      disposePendingHookEvents();
    }
  };
  const hookEventCleanupScope = deps[HEADLESS_HOOK_EVENT_CLEANUP];
  if (hookEventCleanupScope) {
    hookEventCleanupScope.dispose = disposePendingHookEvents;
  }
  if (includeHookEvents) {
    const subscribeHookEvents =
      deps.addHooksV2EventObserver || addHooksV2EventObserver;
    removeHookObserver = subscribeHookEvents(sessionId, (event) => {
      queuePendingHookEvent(event);
      const policyEvent = projectHookPolicyDecision(event);
      if (policyEvent) queuePendingHookEvent(policyEvent);
    });
  }

  const emitHeadlessError = (resultMsg) => {
    if (isStream) {
      writeOut(
        JSON.stringify({
          type: "result",
          subtype: "error",
          is_error: true,
          error: resultMsg,
        }) + "\n",
      );
    } else if (isJson) {
      writeOut(
        JSON.stringify(
          buildResultEnvelope({
            subtype: "error",
            isError: true,
            result: resultMsg,
            sessionId,
            toolCalls: [],
            usage: {},
            numTurns: 0,
            durationMs: 0,
          }),
        ) + "\n",
      );
    }
  };

  // Resume authority is the first host boundary after argument validation.
  // In particular this precedes /config writes, slash-macro bang expansion,
  // settings/plugin loading, bootstrap, model access, hooks, MCP and tools.
  const canReadCanonicalResume =
    !hasInjectedSessionStore || typeof deps.readVerifiedEvents === "function";
  const canonicalAdmissionId = resumeId || (persist ? sessionId : null);
  const canonicalAdmission =
    canonicalAdmissionId && canReadCanonicalResume
      ? readSessionHostResumeState(canonicalAdmissionId, {
          sessionHasPersistedEvidence:
            deps.sessionHasPersistedEvidence ||
            (!hasInjectedSessionStore
              ? jsonlSessionHasPersistedEvidence
              : undefined),
          sessionExists: deps.sessionExists || jsonlSessionExists,
          readVerifiedEvents:
            deps.readVerifiedEvents || jsonlReadVerifiedEvents,
        })
      : null;
  if (canonicalAdmission && !canonicalAdmission.snapshot.verified) {
    const message =
      "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED: canonical JSONL session is not " +
      "fully verified; resume/write admission was refused";
    emitHeadlessError(message);
    writeErr(`${message}\n`);
    disposePendingHookEvents();
    return {
      exitCode: 1,
      result: message,
      isError: true,
      sessionSnapshot: canonicalAdmission.snapshot,
    };
  }
  // A persist-only target must pass the same canonical admission boundary,
  // but it does not opt into replaying the target's prior conversation.
  const canonicalResume = resumeId ? canonicalAdmission : null;

  if (options.observabilityScope != null && canonicalAdmission) {
    const message =
      "CC_OBSERVABILITY_SCOPE_IMMUTABLE: an existing session scope cannot be overwritten; create a new scoped session";
    emitHeadlessError(message);
    writeErr(`${message}\n`);
    disposePendingHookEvents();
    return {
      exitCode: 1,
      result: message,
      isError: true,
      sessionSnapshot: canonicalAdmission.snapshot,
    };
  }

  // `let` (not const): a custom-command macro's `model:` frontmatter may
  // override it below (when the user passed no explicit --model), mirroring
  // `cc command run`.
  let model = options.model || "qwen2.5:7b";
  const provider = options.provider || "ollama";
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || null;
  const cwd = options.cwd || process.cwd();
  const formalQualityHermetic = isFormalQualityHermeticRuntime(process.env);
  const hermeticExecution =
    options.hermeticExecution === true || formalQualityHermetic;
  if (
    options.fileMutationScope != null &&
    (options.exactToolNames !== true || !hermeticExecution)
  ) {
    throw new Error(
      "exact file mutation scope requires exactToolNames=true and hermeticExecution=true",
    );
  }
  const fileMutationScope = normalizeExactFileMutationScope(
    options.fileMutationScope,
    { cwd },
  );
  // Extra workspace roots (--add-dir). Resolved/validated by the caller; we
  // just normalize to a clean string[] here.
  const additionalDirectories = hermeticExecution
    ? []
    : Array.isArray(options.additionalDirectories)
      ? options.additionalDirectories.filter(Boolean)
      : [];

  // .claude/settings.json permission rules (deny > ask > allow). A `deny` hard-
  // blocks, an `allow` pre-authorizes (so a safe op isn't fail-closed headless),
  // an `ask` falls closed (no human to confirm in headless). No file → null →
  // every existing risk-tier / shell-policy layer runs unchanged.
  let permissionRules = hermeticExecution
    ? null
    : options.permissionRules || null;
  let permissionRulesProvider = hermeticExecution
    ? null
    : options.permissionRulesProvider || null;
  let managedSettings = null;
  let settingsFiles = [];
  if (!hermeticExecution) {
    const { createPermissionRulesProvider, loadPermissionAuthority } =
      await import("../lib/permission-authority.js");
    const authorityOptions = {
      cwd,
      settingsFile: options.settingsFile,
      managedSettingsFile: options.managedSettingsFile,
      baseRules: options.permissionRules || null,
    };
    const loaded = loadPermissionAuthority(authorityOptions);
    managedSettings = loaded.managed;
    settingsFiles = Array.isArray(loaded.files) ? loaded.files : [];
    permissionRules = loaded.hasRules ? loaded.rules : null;
    if (!permissionRulesProvider) {
      permissionRulesProvider = createPermissionRulesProvider(authorityOptions);
    }
  }

  // .claude/settings.json `hooks` block — decision-capable PreToolUse/
  // PostToolUse hooks (see settings-hooks/hook-runner). null = no hooks.
  let settingsHooks = hermeticExecution ? null : options.settingsHooks || null;
  if (!hermeticExecution && !settingsHooks) {
    try {
      const { loadHooks, projectHookTrustNotice, attachAuthorityErrors } =
        await import("../lib/settings-hooks.cjs");
      const loaded = loadHooks({ cwd, settingsFile: options.settingsFile });
      // Fold in installed plugins' hooks/hooks.json (Phase 3.3c) — plugins ADD
      // to the user's settings hooks, never replace them.
      const { mergePluginHooks } =
        await import("../lib/plugin-runtime/hooks.js");
      const effectiveHooks = mergePluginHooks(
        attachAuthorityErrors(loaded.hooks, loaded.authorityErrors),
        { cwd },
      );
      settingsHooks =
        Object.keys(effectiveHooks).length > 0 ||
        effectiveHooks._authorityErrors.length > 0
          ? effectiveHooks
          : null;
      // Explain the explicit content-bound trust gate. Displaying this notice
      // never authorizes execution.
      try {
        const notice = projectHookTrustNotice({
          cwd,
          settingsFile: options.settingsFile,
        });
        if (notice) writeErr(notice + "\n");
      } catch {
        /* notice output is best-effort; the runtime gate is fail-closed */
      }
    } catch (error) {
      settingsHooks = {};
      Object.defineProperty(settingsHooks, "_authorityErrors", {
        value: Object.freeze([
          Object.freeze({
            sourceFile: null,
            code: error?.code || "CC_HOOK_AUTHORITY_LOAD_FAILED",
          }),
        ]),
        enumerable: false,
      });
    }
  }

  // Preserve PATH compatibility for trusted legacy bin components that have no
  // sandboxPolicy. Policy-bearing bins are excluded here and resolved as exact
  // direct Broker invocations by agent-core. The process exits at the end of
  // the run, so no explicit restore is needed.
  if (!hermeticExecution) {
    try {
      const { applyPluginBinPath } =
        await import("../lib/plugin-runtime/bin.js");
      applyPluginBinPath({ cwd });
    } catch {
      /* best-effort — plugin bin PATH never blocks a headless run */
    }
  }

  // Apply trusted plugins' default env vars for this run (Phase 3.3o) — only for
  // keys not already set; the process exits at the end so no restore is needed.
  if (!hermeticExecution) {
    try {
      const { applyPluginSettingsEnv } =
        await import("../lib/plugin-runtime/settings.js");
      applyPluginSettingsEnv({ cwd });
    } catch {
      /* best-effort — plugin settings never block a headless run */
    }
  }

  // autoMode.classifyAllShell (Claude-Code 2.1.193): route the built-in
  // verification allowlist through the shell-policy classifier instead of
  // fast-pathing it. Explicit option wins; otherwise read settings.json.
  let classifyAllShell = hermeticExecution
    ? false
    : options.classifyAllShell || false;
  if (!hermeticExecution && !classifyAllShell) {
    try {
      const { readBooleanSetting } = await import("../lib/settings-loader.cjs");
      classifyAllShell =
        readBooleanSetting("autoMode.classifyAllShell", {
          cwd,
          settingsFile: options.settingsFile,
        }) === true;
    } catch {
      classifyAllShell = false; // fail-open
    }
  }

  const runLoop = deps.agentLoop || coreAgentLoop;
  const doBootstrap = deps.bootstrap || bootstrap;
  const executeLifecycleHooks = hermeticExecution
    ? async () => ({
        success: true,
        blocked: false,
        decision: "continue",
        results: [],
      })
    : deps.executeHooksV2Event || executeHooksV2Event;
  const getApprovalGate =
    deps.getApprovalGate ||
    (async () => {
      const m = await import("../lib/session-core-singletons.js");
      return m.getApprovalGate();
    });
  // Session persistence seam (file-based JSONL; DB-free, like the rest of
  // headless). Defaults to the real store; tests inject fakes.
  const storeReadEvents = deps.readEvents || jsonlReadEvents;
  const unavailableAuthorityCapability = (operation) => () => {
    const error = new Error(
      `Injected session store must provide ${operation} for MCP authority`,
    );
    error.code = "SESSION_AUTHORITY_CAPABILITY_UNAVAILABLE";
    throw error;
  };
  const storeFindLatestEvent =
    deps.findLatestEvent ||
    (deps.readEvents
      ? (sessionId, type, predicate = null) => {
          const events = storeReadEvents(sessionId) || [];
          const wanted = Array.isArray(type) ? new Set(type) : null;
          for (let index = events.length - 1; index >= 0; index -= 1) {
            const event = events[index];
            const typeMatches = wanted
              ? wanted.has(event?.type)
              : type == null || event?.type === type;
            if (!typeMatches) continue;
            if (typeof predicate === "function" && !predicate(event)) continue;
            return event;
          }
          return null;
        }
      : hasInjectedSessionStore
        ? () => null
        : jsonlFindLatestEvent);
  const store = {
    sessionExists: deps.sessionExists || jsonlSessionExists,
    rebuildMessages: deps.rebuildMessages || jsonlRebuildMessages,
    startSession: deps.startSession || jsonlStartSession,
    appendUserMessage: deps.appendUserMessage || jsonlAppendUserMessage,
    appendAssistantMessage:
      deps.appendAssistantMessage || jsonlAppendAssistantMessage,
    appendTokenUsage: deps.appendTokenUsage || jsonlAppendTokenUsage,
    appendToolCallCompact:
      deps.appendToolCallCompact ||
      (hasInjectedSessionStore ? () => true : jsonlAppendToolCallCompact),
    appendLlmRetryCompact:
      deps.appendLlmRetryCompact ||
      (hasInjectedSessionStore ? () => true : jsonlAppendLlmRetryCompact),
    appendCompactEvent:
      deps.appendCompactEvent ||
      (hasInjectedSessionStore ? () => true : jsonlAppendCompactEvent),
    appendEvent:
      deps.appendEvent ||
      (hasInjectedSessionStore ? () => true : jsonlAppendEvent),
    appendAuthorityEvent:
      deps.appendAuthorityEvent ||
      (hasInjectedSessionStore
        ? unavailableAuthorityCapability("appendAuthorityEvent")
        : jsonlAppendAuthorityEvent),
    readEvents: storeReadEvents,
    readVerifiedEvents:
      deps.readVerifiedEvents ||
      (hasInjectedSessionStore
        ? unavailableAuthorityCapability("readVerifiedEvents")
        : jsonlReadVerifiedEvents),
    findLatestEvent: storeFindLatestEvent,
    getLastSessionId: deps.getLastSessionId || jsonlGetLastSessionId,
    verifySession:
      deps.verifySession ||
      (hasInjectedSessionStore ? () => null : jsonlVerifySession),
  };
  if (options.observabilityScope != null) {
    let existingSession;
    try {
      existingSession = store.sessionExists(sessionId);
    } catch {
      existingSession = null;
    }
    if (existingSession !== false) {
      const message =
        existingSession === true
          ? "CC_OBSERVABILITY_SCOPE_IMMUTABLE: an existing session scope cannot be overwritten; create a new scoped session"
          : "CC_OBSERVABILITY_SCOPE_AUTHORITY_UNAVAILABLE: existing session authority could not be excluded";
      emitHeadlessError(message);
      writeErr(`${message}\n`);
      disposePendingHookEvents();
      return { exitCode: 1, result: message, isError: true };
    }
  }
  // ── Headless `/config` directive (Claude-Code 2.1.181: /config in -p mode) ──
  // A leading `/config …` prompt is a one-shot config get/set/show, not a task
  // for the LLM — handled before bootstrap/session/model so it never spends a
  // turn or touches a provider. Mirrors the REPL `/config`; secrets stay masked.
  if (isHeadlessConfigCommand(prompt)) {
    const cm = await import("../lib/config-manager.js");
    const { getConfigPath } = await import("../lib/paths.js");
    const { runConfigDirective } =
      await import("../lib/headless-config-command.js");
    const { text, isError } = runConfigDirective(prompt, {
      configManager: cm,
      getConfigPath,
    });
    const subtype = isError ? "error" : "success";
    if (isStream) {
      writeOut(
        JSON.stringify({
          type: "result",
          subtype,
          is_error: isError,
          result: text,
        }) + "\n",
      );
    } else if (isJson) {
      writeOut(
        JSON.stringify(
          buildResultEnvelope({
            subtype,
            isError,
            result: text,
            sessionId: null,
            toolCalls: [],
            usage: null,
            numTurns: 0,
            durationMs: 0,
          }),
        ) + "\n",
      );
    } else {
      writeOut(text + (text.endsWith("\n") ? "" : "\n"));
    }
    return { exitCode: isError ? 1 : 0, result: text, isError };
  }

  if (options.continueSession === true && !resumeId && isText) {
    writeErr("No previous session to continue; starting a new one.\n");
  }

  // ── Custom slash-command macros (Claude-Code parity: a .claude/commands/*
  // command runs in `-p` mode too, not just the interactive REPL). A leading
  // `/name …` that resolves to a user/project command is expanded into its
  // prompt template ($ARGUMENTS / $1.. + !`bang` + @file) before the turn; an
  // unknown `/...` (or plain text) is left untouched so it reaches the LLM
  // verbatim. expandCommand already runs @file expansion, so the @-ref pass
  // below is skipped when a macro matched. Opt out with options.slashMacros:false.
  let userContent = prompt;
  let slashExpanded = false;
  // A matched command's `allowed-tools:` frontmatter scopes the run (parsed
  // below into enabledToolNames) the same way `cc command run` does.
  let macroAllowedTools = null;
  if (
    !hermeticExecution &&
    options.slashMacros !== false &&
    prompt.startsWith("/")
  ) {
    try {
      const doMacro =
        deps.resolveSlashMacro ||
        (await import("../repl/slash-macro.js")).resolveSlashMacro;
      const macro = await doMacro(prompt, { cwd });
      if (macro && macro.matched) {
        userContent = macro.promptText;
        slashExpanded = true;
        for (const w of macro.warnings || []) {
          writeErr(`  /${macro.name}: ${w}\n`);
        }
        writeErr(`  command: /${macro.name} [${macro.scope}]\n`);
        // Frontmatter `model:` / `allowed-tools:` scope the run exactly like
        // `cc command run` — but an explicit --model / --allowed-tools still
        // wins (those arrive as a set options.model / options.allowedTools).
        if (macro.model && !options.model) {
          model = macro.model;
          writeErr(`  command: model → ${model}\n`);
          try {
            const { maybeWarnDeprecatedModel } =
              await import("../lib/model-deprecation.js");
            maybeWarnDeprecatedModel({ model });
          } catch {
            // deprecation notice is best-effort
          }
        }
        if (macro.allowedTools && !options.allowedTools) {
          macroAllowedTools = parseToolList(macro.allowedTools);
        }
      }
    } catch {
      // macro resolution is best-effort — fall back to the literal prompt
    }
  }

  // ── Expand @file references in the prompt (Claude-Code parity) ─────────
  // `@path/to/file` tokens are augmented with the referenced file contents (or
  // a dir listing) so `cc agent -p "review @src/x.js"` works without a manual
  // cat-pipe. Opt out with `--no-file-refs` (options.expandFileRefs === false).
  // Skipped when a slash macro already expanded (expandCommand ran @refs).
  if (
    !hermeticExecution &&
    !slashExpanded &&
    options.expandFileRefs !== false
  ) {
    const doExpand = deps.expandFileRefs || expandFileRefsAsync;
    const expanded = await doExpand(prompt, { cwd });
    userContent = expanded.prompt;
    // Warnings (typo'd paths, unreadable files) go to stderr in every output
    // format so stdout stays a clean machine payload.
    for (const w of expanded.warnings) {
      writeErr(`  @ref: ${w}\n`);
    }
  }

  // ── Permission + tool resolution ──────────────────────────────────────
  if (managedSettings) {
    const { assertManagedPermissionMode } =
      await import("../lib/settings-loader.cjs");
    assertManagedPermissionMode(options.permissionMode, managedSettings);
  }
  const perm = resolvePermissionMode(options.permissionMode);
  const enabledToolNames = formalQualityHermetic
    ? [...FORMAL_QUALITY_FILE_TOOLS]
    : resolveEnabledTools({
        // An explicit --allowed-tools wins; otherwise a matched command's
        // `allowed-tools:` frontmatter scopes the run (null when neither applies).
        allowedTools: options.allowedTools || macroAllowedTools,
        readOnly: perm.readOnly,
      });
  const disabledTools = options.disallowedTools || [];

  // ── Best-effort runtime bootstrap (DB optional, like startAgentRepl) ───
  let db = null;
  if (!hermeticExecution) {
    try {
      // Bootstrap logs db/config diagnostics via console.info (→ stdout); divert
      // to stderr so text/JSON/NDJSON stdout payloads stay clean.
      const ctx = await withQuietStdout(() => doBootstrap({ verbose: false }));
      db = ctx.db || null;
    } catch {
      // Continue without DB — static-prompt fallback.
    }
  }

  const setupHooks = await executeLifecycleHooks(
    "Setup",
    {
      schema_version: 1,
      session_id: sessionId,
      cwd,
      database_available: db != null,
      enabled_tools: enabledToolNames,
      settings_files: settingsFiles,
    },
    { failClosed: true },
  );
  if (setupHooks.blocked || setupHooks.decision === "block") {
    const reason =
      setupHooks.blockingResult?.reason ||
      setupHooks.error ||
      "blocked by Setup hook";
    writeErr(`[hook] ${reason}\n`);
    emitHeadlessError(reason);
    return { exitCode: 2, result: reason, isError: true };
  }

  const expansionHooks = await executeLifecycleHooks(
    "UserPromptExpansion",
    {
      schema_version: 1,
      session_id: sessionId,
      cwd,
      prompt: userContent,
      original_prompt: prompt,
    },
    { failClosed: true },
  );
  const expansion = resolvePromptExpansion(userContent, expansionHooks);
  if (expansion.blocked) {
    const reason = expansion.reason || "blocked by UserPromptExpansion hook";
    writeErr(`[hook] ${reason}\n`);
    emitHeadlessError(reason);
    return { exitCode: 2, result: reason, isError: true };
  }
  userContent = expansion.prompt;

  // Load prior conversation when resuming an existing session. The fresh host
  // system prompt always leads; all system turns from the same verified
  // canonical sample follow it (including compact checkpoint summaries).
  let history = [];
  if (canonicalResume) {
    history = canonicalResume.messages.filter(Boolean);
  } else if (resumeId && store.sessionExists(resumeId)) {
    // Compatibility gate for injected stores without a verified event reader.
    // Real JSONL resumes were handled above and never reach this branch. A
    // broken transcript hash chain means the file was edited
    // outside the store. Headless runs fail closed — a tampered transcript is
    // never silently rebuilt into trusted model context. Escape hatch:
    // CC_ALLOW_TAMPERED_RESUME=1 is retained only for this injected-store path.
    let trust = null;
    try {
      trust = store.verifySession(resumeId);
    } catch {
      trust = null; // verification unavailable → keep legacy behaviour
    }
    if (trust && trust.status === "tampered") {
      if (process.env.CC_ALLOW_TAMPERED_RESUME !== "1") {
        const msg =
          `Session ${resumeId} transcript failed integrity verification (${trust.reason}` +
          (trust.firstInvalidLine ? ` at line ${trust.firstInvalidLine}` : "") +
          `). Refusing to resume tampered context; run 'cc session verify ${resumeId}', or set CC_ALLOW_TAMPERED_RESUME=1 to override.`;
        emitHeadlessError(msg);
        writeErr(msg + "\n");
        return { exitCode: 1, result: msg, isError: true };
      }
      writeErr(
        `⚠ Resuming a TAMPERED transcript (${trust.reason}) — restored context is untrusted.\n`,
      );
    }
    try {
      history = (store.rebuildMessages(resumeId) || []).filter(
        (m) => m && m.role !== "system",
      );
    } catch {
      history = [];
    }
  }

  // ── P0-2: crash-safe side-effect ledger ────────────────────────────────
  // Dangerous tools (file writes, opaque shell, git push, publish/schedule/
  // notify/browser actions) are recorded prepare→start→commit|fail and the
  // full snapshot persisted before the effect settles, so a worker killed
  // mid-flight does NOT blindly replay an effect that may already have landed.
  // Only active when persisting (an ephemeral/one-shot run can't be resumed);
  // the byte-for-byte default path is untouched when no dangerous tool runs.
  // Background phase reporter (P0 state-machine producer): when this run IS a
  // background agent's turn child (CC_BACKGROUND_AGENT_ID set by the worker),
  // human-blocking windows are surfaced into the shared state file. Created
  // here — before the resume reconcile below — so an UNKNOWN-outcome side
  // effect found on resume can be reported too. For every non-background run
  // this is a disabled no-op.
  const _bgPhase = hermeticExecution
    ? Object.freeze({
        enabled: false,
        reportUncertainSideEffects: () => {},
        reportQuestion: () => {},
        wrapConfirmer: (confirmer) => confirmer,
      })
    : deps.backgroundPhaseReporter || createBackgroundPhaseReporter();

  const sideEffectRunNonce = String(deps.now ? deps.now() : Date.now());
  const _backgroundPolicyDigest = _bgPhase.enabled
    ? computePolicyDigest({
        permissionMode: options.permissionMode,
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
        permissionRules,
      })
    : null;
  const _backgroundInteraction = _bgPhase.enabled
    ? deps.backgroundInteractionClient ||
      (
        deps.createBackgroundInteractionClient ||
        createBackgroundInteractionClient
      )({
        backgroundAgentId: process.env.CC_BACKGROUND_AGENT_ID,
        sessionId,
        sessionHostWriteDelegation: sessionHostLease?.leaseId
          ? createSessionHostWriteDelegation(sessionHostLease)
          : null,
        // One headless invocation is one user turn even when its model/tool
        // loop contains several internal iterations.
        turnId: options.turnId || sideEffectRunNonce,
      })
    : null;
  let sideEffectLedger = new SideEffectLedger({ clock: deps.now || null });
  let sideEffectLedgerLoadError = null;
  let sideEffectSeq = 0;
  let currentSideEffectOpId = null;
  let resumeSideEffectContext = null;
  let resumeMcpCallContext = null;
  let resumeMcpRecovery = null;
  let resumeMcpRecoveryError = null;
  let resumeAsyncHookContext = null;
  const persistSideEffectLedger = () => {
    if (!persist) return;
    if (sideEffectLedgerLoadError) throw sideEffectLedgerLoadError;
    try {
      const persisted = store.appendAuthorityEvent(
        sessionId,
        SIDE_EFFECT_LEDGER_EVENT,
        sideEffectLedger.toJSON(),
      );
      if (persisted === false) {
        throw new Error("session store rejected the ledger snapshot");
      }
    } catch (cause) {
      const error = new Error(
        `Side-effect ledger persistence failed for ${sessionId}: ${
          cause?.message || String(cause)
        }`,
        { cause },
      );
      error.code = "SIDE_EFFECT_LEDGER_PERSIST_FAILED";
      throw error;
    }
  };
  // P1 explicit turn→checkpoint binding: feed the TurnBindingLog in real time
  // off the yielded agent-loop events (checkpoint / tool / policy / child-agent)
  // and persist the table as a hash-chained `turn_checkpoint_binding` session
  // event at each turn boundary. Provider tool_use ids are not runner-visible,
  // so tool-call ids are synthesized `<nonce>:c<seq>` (mirrors the side-effect
  // ledger's op-id scheme — stable within a run, unique across resumes).
  // rebuildMessages ignores this event type, so it never pollutes model
  // context. Only writes when a turn actually recorded something, and only for
  // persisted runs — a tool-free Q&A or ephemeral run stays byte-identical.
  let turnBindingLog = new TurnBindingLog();
  let turnBindingLoadError = null;
  if (persist) {
    try {
      const event = store.findLatestEvent(
        sessionId,
        TURN_BINDING_EVENT,
        (candidate) => Array.isArray(candidate?.data?.turns),
      );
      if (event) {
        turnBindingLog = TurnBindingLog.fromJSON(event.data);
      }
    } catch (cause) {
      const error = new Error(
        `Turn binding read failed for ${sessionId}: ${
          cause?.message || String(cause)
        }`,
        { cause },
      );
      error.code = "TURN_BINDING_READ_FAILED";
      turnBindingLoadError = error;
    }
  }
  // Event→table folding + id synthesis live in the SHARED feeder core
  // (createTurnBindingFeed) so the interactive REPL producer can never drift
  // from this runner's mapping. No feed at all for non-persisted runs.
  const turnBindingFeed = persist
    ? createTurnBindingFeed({
        log: turnBindingLog,
        nonce: sideEffectRunNonce,
      })
    : null;
  const persistTurnBindingLog = () => {
    if (!turnBindingFeed || !turnBindingFeed.isDirty()) return;
    if (turnBindingLoadError) throw turnBindingLoadError;
    try {
      const persisted = store.appendAuthorityEvent(
        sessionId,
        TURN_BINDING_EVENT,
        turnBindingLog.toJSON(),
      );
      if (persisted === false) {
        throw new Error("session store rejected the binding snapshot");
      }
      turnBindingFeed.clearDirty();
    } catch (cause) {
      const error = new Error(
        `Turn binding persistence failed for ${sessionId}: ${
          cause?.message || String(cause)
        }`,
        { cause },
      );
      error.code = "TURN_BINDING_PERSIST_FAILED";
      throw error;
    }
  };
  if (persist) {
    try {
      const event = store.findLatestEvent(
        sessionId,
        SIDE_EFFECT_LEDGER_EVENT,
        (candidate) => Array.isArray(candidate?.data?.ops),
      );
      if (event) {
        sideEffectLedger = SideEffectLedger.fromJSON(event.data, {
          clock: deps.now || null,
        });
      }
    } catch (cause) {
      const error = new Error(
        `Side-effect ledger read failed for ${sessionId}: ${
          cause?.message || String(cause)
        }`,
        { cause },
      );
      error.code = "SIDE_EFFECT_LEDGER_READ_FAILED";
      // Keep read-only turns available; classified side effects call the
      // persistence gate above before the generator can execute the tool.
      sideEffectLedgerLoadError = error;
    }
    // On resume, surface any operation that was in flight when the prior run
    // died: its outcome is UNKNOWN, so the model is told to VERIFY before any
    // replay rather than silently re-issue an irreversible effect.
    if (resumeId) {
      try {
        const plan = reconcileSideEffects(sideEffectLedger);
        if (plan.inspect.length > 0) {
          const lines = plan.plans
            .filter((p) => p.action === "inspect")
            .map((p) => {
              const op = sideEffectLedger.get(p.opId);
              const kind = op?.kind || "unknown";
              const key = op?.key ? ` (${op.key})` : "";
              return `  • [${kind}]${key} — ${p.reason}`;
            });
          resumeSideEffectContext =
            "Recovery notice — the previous run was interrupted while these " +
            "irreversible operations were in flight; their outcome is UNKNOWN. " +
            "Do NOT blindly re-run them. Verify whether each already took " +
            "effect before repeating it, and ask the user if unsure:\n" +
            lines.join("\n");
          writeErr(
            `⚠ ${plan.inspect.length} interrupted side-effect(s) need verification before replay (resume ${resumeId}).\n`,
          );
          // P0 state machine: a background child resuming with UNKNOWN-outcome
          // ops advertises `uncertain_side_effect` (dashboard: Needs input) —
          // someone must confirm before any replay. No-op unless this run is a
          // background turn child; best-effort by construction.
          _bgPhase.reportUncertainSideEffects(plan.inspect.length);
        }
      } catch {
        resumeSideEffectContext = null;
      }
      // MCP calls have their own content-free started/settled ledger. A
      // started-only record means the external server may have completed the
      // operation before the process died, so replay must stop for inspection.
      try {
        const mcpRecovery =
          canonicalResume?.recovery ||
          loadMcpLedgerRecovery(resumeId, {
            readVerifiedEvents: store.readVerifiedEvents,
          });
        resumeMcpRecovery = mcpRecovery;
        resumeMcpCallContext = formatMcpLedgerRecoveryNotice(mcpRecovery);
        if (resumeMcpCallContext) {
          const risky = mcpRecovery.unsettled.filter(
            (record) => record.effectContract?.effect !== "read",
          ).length;
          writeErr(
            `⚠ ${mcpRecovery.unsettled.length} interrupted MCP call(s) and ${mcpRecovery.incidents.length} ledger incident(s) require inspection before replay (resume ${resumeId}).\n`,
          );
          if (risky > 0 || mcpRecovery.incidents.length > 0) {
            _bgPhase.reportUncertainSideEffects(
              risky + mcpRecovery.incidents.length,
            );
          }
        }
      } catch (error) {
        resumeMcpRecoveryError = error;
        resumeMcpCallContext =
          "MCP recovery notice — the durable MCP call ledger could not be read. " +
          "Do not execute or retry MCP tools until the session transcript has " +
          `been inspected (${error?.code || "CC_MCP_LEDGER_EVENT_READ_FAILED"}).`;
        writeErr(
          `⚠ MCP ledger recovery failed closed for resume ${resumeId}; MCP calls require inspection.\n`,
        );
        _bgPhase.reportUncertainSideEffects(1);
      }
      // On resume, recover any async-hook REWAKE (a background check that opted
      // in and FAILED) that the previous run parked but died before draining —
      // surface it to the model instead of silently swallowing the failure. The
      // take also clears the bucket so it isn't replayed on a later resume.
      try {
        const { takePending } = await import("../lib/async-hook-queue.cjs");
        const recovered = takePending(
          { sessionId, now: deps.now ? deps.now() : Date.now() },
          deps.asyncHookQueuePath || undefined,
          deps.asyncHookQueueFs || undefined,
        );
        if (Array.isArray(recovered) && recovered.length > 0) {
          const lines = recovered.map((r) => {
            const detail = r.error || r.additionalContext || "failed";
            return `  • ${r.command} — ${detail}`;
          });
          resumeAsyncHookContext =
            "Recovery notice — the previous run was interrupted after these " +
            "background (async) hook checks FAILED but before you were told. " +
            "Review each failure and decide whether it still needs action:\n" +
            lines.join("\n");
          writeErr(
            `⚠ Recovered ${recovered.length} failed async-hook check(s) from interrupted run (resume ${resumeId}).\n`,
          );
        }
      } catch {
        resumeAsyncHookContext = null;
      }
    }
  }
  const diffReviewFollowUps = new DiffReviewFollowUpTracker(sideEffectLedger);

  // ── Wire the persistent ApprovalGate with our non-interactive confirmer
  // and force the session-policy tier dictated by --permission-mode. ──────
  let approvalGate = null;
  if (!hermeticExecution) {
    try {
      approvalGate = await getApprovalGate();
      approvalGate =
        approvalGate?.createSessionScope?.(sessionId) || approvalGate;
      if (approvalGate && (options.permissionMode || "default") === "auto") {
        // autoMode.decisions: user-configured riskLevel → allow/ask/deny
        // classifier. Only wrap when settings actually customize the map so the
        // unconfigured auto path keeps the byte-identical trusted-tier mapping.
        try {
          const {
            loadAutoModeConfig,
            resolveAutoModeDecisions,
            createAutoModeApprovalGate,
          } = await import("../lib/auto-mode-config.js");
          const autoConfig = loadAutoModeConfig({
            cwd,
            settingsFile: options.settingsFile,
          });
          const resolved = resolveAutoModeDecisions(autoConfig.effective);
          if (resolved.customized) {
            approvalGate = createAutoModeApprovalGate(approvalGate, resolved);
          }
        } catch {
          // fail to the default trusted mapping — never block the run
        }
      }
      if (approvalGate) {
        approvalGate.setAuthorizationConsumer?.(null);
        if (typeof approvalGate.setSessionPolicy === "function") {
          await approvalGate.setSessionPolicy(sessionId, perm.sessionPolicy);
          await approvalGate.awaitPersistence?.();
        }
        if (typeof approvalGate.setConfirmer === "function") {
          approvalGate.setConfirmer(perm.confirmer);
        }
      }
    } catch {
      approvalGate = null;
    }
  }

  const budget = Number.isFinite(options.maxTurns)
    ? new IterationBudget({
        limit: Math.max(1, Math.floor(options.maxTurns)),
      })
    : new IterationBudget();

  // Effective system prompt: built-in base, optionally replaced by
  // --system-prompt and/or extended by --append-system-prompt.
  // --output-style (or settings.json `outputStyle`) → a persona appended to the
  // system prompt. Resolved best-effort; a missing style is ignored with a warn.
  let outputStyleBody = null;
  if (!hermeticExecution) {
    try {
      const { resolveOutputStyle } = await import("../lib/output-styles.js");
      const st = resolveOutputStyle(options.outputStyle, cwd);
      if (st && st.missing && options.outputStyle) {
        writeErr(`  output-style: unknown style "${options.outputStyle}"\n`);
      } else if (st && st.body) {
        outputStyleBody = st.body;
      }
    } catch {
      outputStyleBody = null;
    }
  }

  // Large-monorepo context lever: `instructionExcludes` (settings.json or an
  // explicit caller/SDK option) suppresses cc.md/CLAUDE.md/AGENTS.md, path-scoped
  // rules, and @imports that resolve into legacy/vendor/generated subtrees.
  // Explicit option wins; otherwise union across the layered settings files.
  let instructionExcludes =
    !hermeticExecution && Array.isArray(options.instructionExcludes)
      ? options.instructionExcludes
      : null;
  if (!hermeticExecution && !instructionExcludes) {
    try {
      const { readStringArraySetting } =
        await import("../lib/settings-loader.cjs");
      const fromSettings = readStringArraySetting("instructionExcludes", {
        cwd,
        settingsFile: options.settingsFile,
      });
      if (fromSettings && fromSettings.length)
        instructionExcludes = fromSettings;
    } catch {
      instructionExcludes = null; // fail-open
    }
  }

  // --no-project-memory (options.projectMemory === false): lean prompt — skip
  // rules.md (in buildSystemPrompt) + the cc.md/CLAUDE.md block. Absent flag
  // (undefined) leaves both paths byte-identical.
  const _leanNoProjectMemory =
    hermeticExecution || options.projectMemory === false;
  let _loadedInstructions = null;
  let _loadedPersonaSkills = [];
  let _skillCacheLedger = null;
  const _runtimeSkillLoader = hermeticExecution
    ? HERMETIC_SKILL_LOADER
    : options.skillLoader || new CLISkillLoader();
  const systemContent = hermeticExecution
    ? composeSystemPrompt(
        "You are a hermetic code fixer. The exposed file tools are the complete tool surface. Inspect and mutate only the exact paths authorized in the user request, then return a concise completion message.",
        { projectMemory: false },
      )
    : composeSystemPrompt(
        buildSystemPrompt(cwd, {
          additionalDirectories,
          projectMemory: options.projectMemory,
          sessionId,
          skillLoader: _runtimeSkillLoader,
          onSkillsLoaded: (skills, cacheLedger) => {
            _loadedPersonaSkills = Array.isArray(skills) ? skills : [];
            _skillCacheLedger = cacheLedger || null;
          },
        }),
        {
          systemPrompt: options.systemPrompt,
          appendSystemPrompt: options.appendSystemPrompt,
          outputStyle: outputStyleBody,
          instructionExcludes,
          projectMemory: _leanNoProjectMemory ? false : undefined,
          onInstructionsLoaded: (loaded) => {
            _loadedInstructions = loaded;
          },
        },
      );

  // settings.json UserPromptSubmit hooks. block → abort the run; context → inject.
  if (settingsHooks) {
    try {
      const { runUserPromptSubmitHooks } =
        await import("../lib/settings-hook-events.js");
      const ups = await runUserPromptSubmitHooks(settingsHooks, {
        prompt: userContent,
        cwd,
        sessionId,
      });
      if (ups.blocked) {
        writeErr(
          `[hook] prompt blocked${ups.reason ? ": " + ups.reason : ""}\n`,
        );
        const reason = ups.reason || "blocked by UserPromptSubmit hook";
        emitHeadlessError(reason);
        return { exitCode: 2, result: reason, isError: true };
      }
      if (ups.additionalContext) {
        userContent += `\n\n[hook context]\n${ups.additionalContext}`;
      }
    } catch (_err) {
      // settings hook dispatch is best-effort
    }
  }

  // settings.json InstructionsLoaded hooks (observe-only): the project-instruction
  // block was just composed — fire with the EXACT loaded file set so a hook can
  // audit which cc.md/CLAUDE.md/AGENTS.md/rules are authoritative this session.
  // Any emitted context is injected like SessionStart's. Best-effort; no-op when
  // project memory is off (no loaded set) or no hook is registered.
  let instructionsLoadedContext = null;
  if (settingsHooks && _loadedInstructions) {
    try {
      const { runInstructionsLoadedHooks } =
        await import("../lib/settings-hook-events.js");
      instructionsLoadedContext = (
        await runInstructionsLoadedHooks(settingsHooks, {
          files: _loadedInstructions.files,
          cwd,
          sessionId,
        })
      ).additionalContext;
    } catch (_err) {
      instructionsLoadedContext = null;
    }
  }

  // settings.json SessionStart hooks → inject session context (observe-only).
  let sessionStartContext = null;
  if (settingsHooks) {
    try {
      const { runSessionStartHooks } =
        await import("../lib/settings-hook-events.js");
      sessionStartContext = (
        await runSessionStartHooks(settingsHooks, {
          source: resumeId ? "resume" : "startup",
          cwd,
          sessionId,
        })
      ).additionalContext;
    } catch (_err) {
      sessionStartContext = null;
    }
  }

  // settings.json SessionResume hooks: fire when a persisted session's prior
  // history is actually being replayed (--resume / --continue with real
  // history), distinct from SessionStart (which also fires on a fresh startup).
  // A SessionResume hook can react to "we're picking an existing conversation
  // back up" — e.g. re-run a workspace sanity check. Observe-only, best-effort.
  if (settingsHooks && resumeId && history.length > 0) {
    try {
      const { runObserveHooks } =
        await import("../lib/settings-hook-events.js");
      await runObserveHooks(
        settingsHooks,
        "SessionResume",
        {
          session_id: sessionId,
          resumed_from: resumeId,
          history_messages: history.length,
          cwd,
        },
        { cwd },
      );
    } catch (_err) {
      // observe-only
    }
  }

  // --image <path>: attach vision input to the user turn. buildUserContent
  // returns the plain string when there are no images, so text-only runs are
  // byte-for-byte unchanged; with images it builds an OpenAI-style multimodal
  // content array (agent-core converts it per-provider for ollama/anthropic).
  const userMessageContent = buildUserContent(userContent, options.images);

  // Merge consecutive same-role turns so a resumed session whose previous run
  // produced NO assistant response (history ends with a bare `user` turn) does
  // not yield two adjacent `user` messages — which Anthropic/Bedrock reject as
  // "roles must alternate", failing the resume (Claude Code 2.1.187 parity).
  // No-op on a healthy alternating transcript.
  const messages = mergeConsecutiveMessages([
    { role: "system", content: systemContent },
    ...(instructionsLoadedContext
      ? [{ role: "system", content: instructionsLoadedContext }]
      : []),
    ...(sessionStartContext
      ? [{ role: "system", content: sessionStartContext }]
      : []),
    ...(resumeSideEffectContext
      ? [{ role: "system", content: resumeSideEffectContext }]
      : []),
    ...(resumeMcpCallContext
      ? [{ role: "system", content: resumeMcpCallContext }]
      : []),
    ...(resumeAsyncHookContext
      ? [{ role: "system", content: resumeAsyncHookContext }]
      : []),
    ...history,
    { role: "user", content: userMessageContent },
  ]);

  // Persist the user turn before model/tool side effects. A full or read-only
  // session disk is a recoverability contract failure, so it fails closed
  // while the requested turn is still side-effect free. startSession is
  // append-safe: only seed the header when the file does not yet exist.
  if (persist) {
    try {
      if (!store.sessionExists(sessionId)) {
        store.startSession(sessionId, {
          title: prompt.slice(0, 60),
          provider,
          model,
          observabilityScope: options.observabilityScope,
          executionLocation: captureAmbientExecutionLocation({
            provider,
            model,
          }),
        });
      }
      // Persist the expanded content so a resumed session faithfully replays
      // what the model actually saw (the file snapshot, not just the @token).
      store.appendUserMessage(sessionId, userContent);
    } catch (error) {
      const persistenceError = createSessionPersistenceFailure(error, {
        sessionId,
        operation: "user-turn-append",
      });
      const persistence = projectSessionPersistenceFailure(persistenceError, {
        phase: "before-model",
      });
      if (persistence) {
        try {
          deps.onPersistenceFailure?.(persistence);
        } catch {
          // Observability cannot change persistence semantics.
        }
        const resultMsg = `${persistence.code}: session turn was not durably persisted`;
        if (isStream) {
          writeOut(
            JSON.stringify({
              type: "result",
              subtype: "error_persistence",
              is_error: true,
              error: resultMsg,
              session_id: sessionId,
              persistence,
            }) + "\n",
          );
        } else if (isJson) {
          writeOut(
            JSON.stringify(
              buildResultEnvelope({
                subtype: "error_persistence",
                isError: true,
                result: resultMsg,
                sessionId,
                toolCalls: [],
                usage: {},
                numTurns: 0,
                durationMs: 0,
                persistence,
              }),
            ) + "\n",
          );
        } else {
          writeErr(
            `${resultMsg} (${persistence.fs_code}; ${persistence.commit_state})\n`,
          );
        }
        return {
          exitCode: 1,
          result: resultMsg,
          isError: true,
          persistence,
        };
      }
      // Preserve legacy best-effort handling for errors outside the explicit
      // ENOSPC/EROFS durability contract.
    }
  }

  // --mcp-config: connect ad-hoc MCP servers for this run and expose their
  // tools to the LLM (Claude-Code parity). Connection is best-effort — a server
  // that fails to connect is logged to stderr and contributes no tools; a
  // missing/empty config file fails fast (the user explicitly asked for MCP).
  // Combine the ad-hoc --mcp-config file with the servers registered via
  // `cc mcp add` (their --auto-connect ones) into ONE client, exposing every
  // tool to the LLM. A bad --mcp-config file fails fast; registered connects
  // are best-effort. --no-mcp disables the registered set (ad-hoc still loads).
  let mcp = null;
  const exactToolCeilingExcludesMcp =
    hermeticExecution ||
    (options.exactToolNames === true &&
      Array.isArray(enabledToolNames) &&
      !enabledToolNames.some((name) => String(name).startsWith("mcp__")) &&
      !options.permissionPromptTool);
  if (!exactToolCeilingExcludesMcp) {
    const doResolve = deps.resolveAgentMcp || resolveAgentMcp;
    try {
      mcp = await doResolve(
        {
          mcpConfigPath: options.mcpConfig || null,
          managedSettingsFile: options.managedSettingsFile,
          db: db?.getDatabase?.() || null,
          includeRegistered: options.useRegisteredMcp !== false,
          // --strict-mcp-config: use ONLY the --mcp-config servers, ignoring
          // registered (cc mcp add) + IDE bridge auto-discovery.
          strict: options.strictMcpConfig === true,
          ide: options.ide,
          pdh: options.pdh,
          jetbrains: options.jetbrains,
          cwd: options.cwd || process.cwd(),
          // advertise the session id to spawned stdio MCP servers
          sessionId,
        },
        {
          writeErr,
          // `mcp_server_errors` carries skipped config entries for machine
          // consumers. Text-mode terminal runs additionally receive the short
          // human warning; JSON/NDJSON keep stderr quiet for stable parsing.
          mcpConfigWarnings: isText,
          loadMcpConfig: deps.loadMcpConfig,
          loadRegisteredMcp: deps.loadRegisteredMcp,
          loadIdeMcp: deps.loadIdeMcp,
          loadJetbrainsMcp: deps.loadJetbrainsMcp,
        },
      );
      if (mcp && isText) {
        for (const c of mcp.connected) {
          writeErr(`  mcp: ${c.server} (${c.tools} tools)\n`);
        }
      }
      // MCP tool search (context scaling): when the tool schemas would eat a
      // significant share of the context window, defer them behind the
      // internal tool_search tool. Below-threshold / disabled → no-op, the
      // wiring object is untouched.
      if (mcp) {
        try {
          (deps.maybeApplyToolSearch || maybeApplyToolSearch)(mcp, {
            model,
            provider,
            cwd: options.cwd || process.cwd(),
            writeErr: isText ? writeErr : () => {},
          });
        } catch {
          // best-effort — full schemas still work without deferral
        }
      }
    } catch (err) {
      writeErr(`Error: ${err.message}\n`);
      emitHeadlessError(err.message);
      // Bad --mcp-config / MCP wiring is a CONFIG error, not a run failure.
      return {
        exitCode: HEADLESS_EXIT_CODES.CONFIG_ERROR,
        result: err.message,
        isError: true,
      };
    }
  }

  const mcpRecoveryRuntime = createMcpHostRecoveryRuntime({
    bundle: mcp,
    sessionId,
    sink: persist
      ? createSessionMcpLedgerSink(
          sessionId,
          hasInjectedSessionStore
            ? { appendEvent: store.appendAuthorityEvent }
            : { recovery: resumeMcpRecovery },
        )
      : null,
    recovery: resumeMcpRecovery,
    recoveryError: resumeMcpRecoveryError,
    dispatchAdmission: sessionHostLease?.admitMcpDispatch || null,
  });
  const hostMcp = mcp
    ? { ...mcp, mcpClient: mcpRecoveryRuntime.client || mcp.mcpClient }
    : null;
  let teamMessageTools = null;
  try {
    teamMessageTools = await (
      deps.resolveTeamMessageToolBundle || resolveTeamMessageToolBundle
    )({ env: options.teamMessageEnv || process.env });
  } catch (error) {
    writeErr(`Error: ${error.message}\n`);
    emitHeadlessError(error.message);
    return {
      exitCode: HEADLESS_EXIT_CODES.CONFIG_ERROR,
      result: error.message,
      isError: true,
    };
  }

  // Seed MCP roots for --add-dir (Claude-Code roots/list_changed parity): a
  // headless session started with extra workspace roots must advertise the FULL
  // root list to connected MCP servers, exactly like the REPL /add-dir path —
  // otherwise a server's roots/list only ever sees the cwd. Only meaningful when
  // extra roots exist (setRoots fires only when the list actually changes); no
  // --add-dir → workspaceRootDirs = [cwd] and this is a no-op. Best-effort.
  if (hostMcp?.mcpClient && additionalDirectories.length > 0) {
    try {
      const { notifyMcpRootsChanged, workspaceRootDirs } =
        await import("../repl/add-dir.js");
      notifyMcpRootsChanged(
        [hostMcp.mcpClient],
        workspaceRootDirs(options.cwd || process.cwd(), additionalDirectories),
      );
    } catch {
      // best-effort — root advertisement never blocks a run
    }
  }

  // IDE live context (Claude-Code parity): when an IDE bridge is connected,
  // share the editor's selection/active file/open tabs with this turn. Appended
  // to the in-flight user message only — AFTER persistence — so a resumed
  // session replays the prompt, not a stale editor snapshot. Best-effort with
  // a short timeout; CC_IDE_CONTEXT=0 disables.
  if (!hermeticExecution) {
    try {
      const { buildIdePromptContext, appendTextToContent, expandIdeMentions } =
        await import("../lib/ide-context.js");
      const last = messages[messages.length - 1];
      const ideCtx = await (
        deps.buildIdePromptContext || buildIdePromptContext
      )(hostMcp);
      if (ideCtx) {
        last.content = appendTextToContent(last.content, ideCtx);
      }
      // Explicit @selection / @diagnostics mentions in the user's prompt
      // (Claude-Code parity). Scan the ORIGINAL prompt so injected file-ref
      // blocks can't spoof a mention; append the expansion to the in-flight
      // message only (ephemeral, like the ambient block above).
      const mentioned = await expandIdeMentions(prompt, hostMcp);
      for (const w of mentioned.warnings) writeErr(`  @ide: ${w}\n`);
      if (mentioned.block) {
        last.content = appendTextToContent(last.content, mentioned.block);
      }
    } catch {
      // IDE context is optional polish — never fail the run over it.
    }
  }

  // (`_bgPhase` — the background phase reporter — is created before the resume
  // reconcile block above; the confirmers below reuse it to surface their
  // pending window as `phase: "waiting_permission"` + `pendingApprovals`.)

  // --permission-prompt-tool: route every CONFIRM-tier approval to an MCP tool
  // (loaded via --mcp-config) instead of headless fail-closed. Overrides the
  // permission-mode confirmer on the gate for this session.
  if (!hermeticExecution && options.permissionPromptTool) {
    let ppt;
    try {
      ppt = resolvePermissionPromptTool(mcp, options.permissionPromptTool);
    } catch (err) {
      writeErr(`Error: ${err.message}\n`);
      await cleanupDeadline.run("mcp", () => mcp?.mcpClient?.disconnectAll?.());
      const cleanupReport = cleanupDeadline.report();
      try {
        deps.onCleanupReport?.(cleanupReport);
      } catch {
        // Metrics/reporting cannot change cleanup semantics.
      }
      emitHeadlessError(err.message);
      // A bad --permission-prompt-tool reference is a CONFIG error.
      return {
        exitCode: HEADLESS_EXIT_CODES.CONFIG_ERROR,
        result: err.message,
        isError: true,
      };
    }
    if (approvalGate && typeof approvalGate.setConfirmer === "function") {
      approvalGate.setConfirmer(
        _bgPhase.wrapConfirmer(
          makePermissionPromptConfirmer({
            mcpClient: hostMcp.mcpClient,
            server: ppt.server,
            tool: ppt.tool,
            writeErr,
            isText,
          }),
        ),
      );
    }
  }

  // --remote-control: route CONFIRM-tier approvals to paired mobile/web
  // devices (第四阶段 #2). Self-hosts a lightweight WS server + approval
  // bridge for THIS run's session, prints the pairing URI/QR to stderr, and
  // installs the remote confirmer on the gate (same override point as
  // --permission-prompt-tool; that flag wins when both are given since it is
  // installed above and this block skips). Fail-closed on timeout.
  let _remoteApproval = null;
  if (
    !hermeticExecution &&
    options.remoteControl &&
    !options.permissionPromptTool
  ) {
    try {
      if (
        !approvalGate ||
        typeof approvalGate.setConfirmer !== "function" ||
        typeof approvalGate.setAuthorizationConsumer !== "function" ||
        typeof approvalGate.consumeAuthorization !== "function"
      ) {
        const error = new Error(
          "installed session-core cannot bind and consume durable remote approval",
        );
        error.code = "CC_REMOTE_APPROVAL_GATE_UNAVAILABLE";
        throw error;
      }
      const { startHeadlessRemoteApproval } =
        await import("../lib/remote-approval-bridge.js");
      _remoteApproval = await (
        deps.startHeadlessRemoteApproval || startHeadlessRemoteApproval
      )({
        agentSessionId: sessionId,
        writeErr,
        isText,
        allowLan: options.remoteControlAllowLan === true,
        env: process.env,
      });
      approvalGate.setConfirmer(
        _bgPhase.wrapConfirmer(_remoteApproval.confirmer),
      );
      approvalGate.setAuthorizationConsumer(
        _remoteApproval.consumeAuthorization,
      );
    } catch (err) {
      // Remote approval could not come up → keep headless fail-closed rather
      // than running un-gated; say why so the user can fix pairing.
      writeErr(`  remote-control: unavailable (${err.message})\n`);
      _remoteApproval = null;
    }
  }

  // Attach an OpenTelemetry recorder when either the legacy --otlp file sink or
  // the process-level Collector exporter is enabled. Both sinks consume the
  // same privacy-gated spans; the default path remains zero cost.
  let _otlpRecorder = null;
  let _collectorEnabled = false;
  if (!hermeticExecution) {
    try {
      const { isOtlpCollectorEnabled } =
        await import("../lib/observability/index.js");
      _collectorEnabled = isOtlpCollectorEnabled();
    } catch {
      _collectorEnabled = false;
    }
  }
  if (!hermeticExecution && (options.otlp || _collectorEnabled)) {
    try {
      const { TelemetryRecorder } =
        await import("../lib/telemetry/span-recorder.js");
      _otlpRecorder = new TelemetryRecorder({ serviceName: "cc-agent" });
    } catch {
      _otlpRecorder = null; // telemetry is best-effort, never blocks the run
    }
  }

  // Async-hook supervisor for headless: without one, `async:true` hooks
  // (PostToolUse / Stop) were silently skipped in `cc agent -p` (they only ran
  // in the REPL). Create one when settings hooks are present so background
  // checks run + get reaped here too. Fire-and-forget; drained after the loop.
  let _hookSupervisor = null;
  if (settingsHooks) {
    try {
      const { AsyncHookSupervisor } =
        await import("../lib/async-hook-supervisor.js");
      _hookSupervisor = new AsyncHookSupervisor({
        persistStats: true,
        // Durably park failed-rewake signals keyed by session so a crash before
        // the turn loop drains them doesn't lose the failure — recovered on the
        // next `--resume` (see the resume block above). Only a PERSISTABLE
        // session can be resumed, so the queue follows `persist`; a one-shot /
        // --ephemeral run stays byte-unchanged (no session id → no writes).
        persistQueue: persist,
        sessionId: persist ? sessionId : null,
      });
    } catch {
      _hookSupervisor = null; // async hooks are best-effort
    }
  }

  // Resolve auto-pin (flag > env > config > default-on). Config read is
  // best-effort — a broken config file must not take headless down.
  let _autoPinResolved = false;
  if (!hermeticExecution) {
    const { resolveAutoPinOption } = await import("./auto-pin.js");
    let _autoPinCfg;
    try {
      const { loadConfig } = await import("../lib/config-manager.js");
      _autoPinCfg = loadConfig()?.context?.autoPin;
    } catch {
      _autoPinCfg = undefined;
    }
    _autoPinResolved = resolveAutoPinOption({
      flag: options.autoPin === true,
      config: _autoPinCfg,
    });
  }

  // Persist the admitted runtime schema surface so `cc context --sources` can
  // attribute MCP cost to the actual server/tool definitions used by this run,
  // rather than guessing from the current environment on a later invocation.
  const persistContextSources = () => {
    if (!persist) return false;
    _skillCacheLedger =
      _runtimeSkillLoader.getCacheLedger?.() || _skillCacheLedger;
    if (
      !mcp?.extraToolDefinitions?.length &&
      !_loadedPersonaSkills.length &&
      !_skillCacheLedger?.descriptors?.resident
    ) {
      return false;
    }
    try {
      store.appendEvent(sessionId, "context_sources", {
        mcp: (mcp?.extraToolDefinitions || []).map((definition) => ({
          function: {
            name: definition?.function?.name || null,
            description: definition?.function?.description || "",
            parameters: definition?.function?.parameters || {},
          },
        })),
        skills: _loadedPersonaSkills.map((skill) => ({
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
        skillCache: _skillCacheLedger,
      });
      return true;
    } catch {
      // Source attribution is observability-only; never fail the agent run.
      return false;
    }
  };
  persistContextSources();

  // Scoped call-ledger writes are safety boundaries, not best-effort
  // diagnostics. Normalize every persistence failure so the outer host aborts
  // this turn and cannot begin another paid model/tool call.
  const persistRuntimeLedgerWrite = (action) => {
    try {
      return action();
    } catch (error) {
      throw markRuntimeLedgerPersistenceError(error);
    }
  };

  // Subagent internals may contain prompts and tool results.  The public
  // stream exposes only stable lifecycle/progress metadata, and only with the
  // explicit --include-hook-events opt-in.
  const headlessInteraction = {};
  if (includeHookEvents) {
    headlessInteraction.emit = (kind, payload = {}) => {
      const subAgentId =
        typeof payload.subAgentId === "string" && payload.subAgentId.trim()
          ? payload.subAgentId.slice(0, 160)
          : null;
      if (!subAgentId) return;
      const parentId =
        typeof payload.parentSessionId === "string" &&
        payload.parentSessionId.trim()
          ? payload.parentSessionId.slice(0, 160)
          : sessionId;
      const base = {
        schema_version: 1,
        subagent_id: subAgentId,
        parent_id: parentId,
        ...(typeof payload.role === "string" && payload.role.trim()
          ? { role: payload.role.trim().slice(0, 96) }
          : {}),
      };
      if (kind === "sub-agent.started") {
        emitStream({
          type: "subagent_started",
          ...base,
          background: payload.background === true,
          ...(Number.isFinite(payload.maxIterations)
            ? { max_iterations: Math.max(0, Math.floor(payload.maxIterations)) }
            : {}),
        });
      } else if (
        kind === "sub-agent.completed" ||
        kind === "sub-agent.failed"
      ) {
        emitStream({
          type: "subagent_completed",
          ...base,
          status: kind === "sub-agent.failed" ? "failed" : "completed",
          background: payload.background === true,
          ...(Number.isFinite(payload.iterationCount)
            ? {
                iteration_count: Math.max(
                  0,
                  Math.floor(payload.iterationCount),
                ),
              }
            : {}),
        });
      } else if (kind === "sub-agent.progress") {
        emitStream({
          type: "subagent_progress",
          ...base,
          event_type:
            typeof payload.event_type === "string"
              ? payload.event_type.slice(0, 96)
              : "unknown",
          ...(typeof payload.tool === "string" && payload.tool
            ? { tool: payload.tool.slice(0, 128) }
            : {}),
          ...(Number.isFinite(payload.iteration_count)
            ? {
                iteration_count: Math.max(
                  0,
                  Math.floor(payload.iteration_count),
                ),
              }
            : {}),
          ...(Number.isFinite(payload.token_count)
            ? { token_count: Math.max(0, Math.floor(payload.token_count)) }
            : {}),
        });
      }
    };
  }
  if (_bgPhase.enabled) {
    headlessInteraction.askUser = async ({
      question,
      options: qOptions,
      multiSelect,
      timeoutMs,
      defaultValue,
      toolUseId,
      turnId,
      policyDigest,
    } = {}) => {
      _bgPhase.reportQuestion({
        question: typeof question === "string" ? question : "",
        options: Array.isArray(qOptions) ? qOptions : null,
      });
      return _backgroundInteraction.request({
        kind: "question",
        question,
        options: qOptions,
        multiSelect,
        timeoutMs,
        defaultValue,
        toolUseId,
        turnId,
        policyDigest: policyDigest || _backgroundPolicyDigest,
        sessionId,
      });
    };
  }

  const childToolExecs = new Map();
  const loopOptions = {
    model,
    provider,
    recorder: _otlpRecorder,
    // --otlp-content: opt in to stamping prompt CONTENT onto --otlp spans. Off by
    // default → content stays redacted (agent-core omits it entirely, so default
    // OTLP output is byte-identical). Only meaningful when a recorder is attached.
    otlpIncludeContent: options.otlpContent === true,
    hookSupervisor: _hookSupervisor,
    // Extended thinking (Anthropic; opt-in via --think/--ultrathink). null/off
    // → chatWithTools sends no thinking field. thinkingBudget (--thinking-budget)
    // is the legacy-model budget_tokens override; ignored when thinking is off.
    thinking: options.thinking || null,
    thinkingBudget: options.thinkingBudget || null,
    baseUrl,
    apiKey,
    cwd,
    skillLoader: _runtimeSkillLoader,
    ...(skillOutcomeIndex === null ? {} : { skillOutcomeIndex }),
    ...(skillVectorAuthority === null ? {} : { skillVectorAuthority }),
    ...(skillRetrievalRevocationReader === null
      ? {}
      : { skillRetrievalRevocationReader }),
    additionalDirectories,
    sandbox: options.sandbox || null,
    sessionId,
    sessionBudget: options.sessionBudget || null,
    hostResourceBudget,
    // Content-free continuity metadata from the same verified sample used for
    // replay history and MCP recovery authority.
    sessionHostSnapshot: canonicalResume?.snapshot || null,
    // Auto-pin (default ON since 2026-07-07): pin the original task through
    // compaction. Precedence: --auto-pin flag > CC_AUTO_PIN ("1"/"0") >
    // config context.autoPin > default on. Falsy → agent-core passes no pin
    // predicate and compaction is byte-identical.
    autoPin: _autoPinResolved,
    autoCheckpoint: options.autoCheckpoint || false,
    checkpointSession: options.checkpointSession || sessionId,
    managedCheckpoint: options.managedCheckpoint === true,
    managedCheckpointStateDir: options.managedCheckpointStateDir || null,
    managedCheckpointExclusions: options.managedCheckpointExclusions || [],
    hookDb: hermeticExecution ? null : db,
    approvalGate: hermeticExecution ? null : approvalGate,
    permissionRules: hermeticExecution ? null : permissionRules,
    permissionRulesProvider: hermeticExecution ? null : permissionRulesProvider,
    settingsHooks: hermeticExecution ? null : settingsHooks,
    // Seed the subagent-contract CEILING with this run's permission mode so a
    // spawned sub-agent inherits/tightens from it (tighten-only): a
    // `--permission-mode bypassPermissions` run can hand a child bypass (→ allow
    // confirmer), a `--permission-mode plan` run clamps children to read-only,
    // while a "default" run resolves children to "default" exactly as before
    // (byte-identical — the previous null ceiling also yielded "default").
    subAgentContract: { permissionMode: options.permissionMode || "default" },
    classifyAllShell,
    enabledToolNames,
    disabledTools,
    exactToolNames: options.exactToolNames === true,
    fileMutationScope,
    hermeticExecution,
    iterationBudget: budget,
    toolAdmission: hermeticExecution ? null : options.toolAdmission || null,
    ...(Object.keys(headlessInteraction).length > 0
      ? { interaction: headlessInteraction }
      : {}),
    // --mcp-config wiring: tool defs for the LLM + dispatch map + live client.
    mcpClient: mcp?.mcpClient || null,
    mcpHostClient: mcpRecoveryRuntime.client || mcp?.mcpClient || null,
    extraToolDefinitions:
      mcp?.extraToolDefinitions || teamMessageTools?.extraToolDefinitions
        ? [
            ...(mcp?.extraToolDefinitions || []),
            ...(teamMessageTools?.extraToolDefinitions || []),
          ]
        : undefined,
    externalToolExecutors:
      mcp?.externalToolExecutors || teamMessageTools?.externalToolExecutors
        ? {
            ...(mcp?.externalToolExecutors || {}),
            ...(teamMessageTools?.externalToolExecutors || {}),
          }
        : undefined,
    externalToolDescriptors:
      mcp?.externalToolDescriptors || teamMessageTools?.externalToolDescriptors
        ? {
            ...(mcp?.externalToolDescriptors || {}),
            ...(teamMessageTools?.externalToolDescriptors || {}),
          }
        : undefined,
    // Persist every MCP started/settled record into this exact canonical
    // session. Unknown/write/destructive prewrite failure then blocks before
    // the external call; a settlement failure leaves a recoverable started row.
    // Keep the guarded in-memory ledger when persistence is disabled so an
    // outcome-unknown call still latches UNSAFE for the rest of this process.
    mcpCallLedger: mcpRecoveryRuntime.ledger,
    mcpDispatchAdmission: hermeticExecution
      ? null
      : sessionHostLease?.admitMcpDispatch || null,
    // chatFn passthrough lets tests drive the loop deterministically.
    chatFn: deps.chatFn || options.chatFn || undefined,
    signal: options.signal || undefined,
    // Stream-stall hint (Claude-Code 2.1.185): when the connection is alive but
    // the API has gone silent mid-response, a headless run would otherwise look
    // frozen with no feedback. The REPL already surfaces this; mirror it here to
    // stderr — out-of-band for every output format (text answer / json envelope
    // / stream-json NDJSON all go to stdout) so machine consumers are unaffected
    // while a human watching a long `cc agent -p` run learns we're still waiting
    // and, when a hard inactivity timeout is set, when it will auto-retry. Plain
    // text (no chalk) since headless stderr is frequently piped/non-TTY.
    onStreamRetry: (attempt, error, telemetry = {}) => {
      writeErr(`  ⟳ connection dropped — retrying (attempt ${attempt})…\n`);
      if (persist) {
        persistRuntimeLedgerWrite(() =>
          store.appendLlmRetryCompact(sessionId, {
            attempt,
            durationMs: telemetry.durationMs,
            provider: telemetry.provider || provider,
            model: telemetry.model || model,
            reason: classifyStreamRetryReason(error),
          }),
        );
      }
    },
    onUsageBoundary: persist
      ? (event) => {
          persistRuntimeLedgerWrite(() =>
            store.appendEvent(
              sessionId,
              runtimeUsageEventType("started"),
              projectRuntimeUsageBoundary(event, "started"),
            ),
          );
        }
      : undefined,
    onUsageSettlement: persist
      ? (event) => {
          if (event?.type === "token-usage") {
            persistRuntimeLedgerWrite(() =>
              store.appendTokenUsage(
                sessionId,
                projectRuntimeTokenUsage(event),
              ),
            );
            return;
          }
          persistRuntimeLedgerWrite(() =>
            store.appendEvent(
              sessionId,
              runtimeUsageEventType("unknown"),
              projectRuntimeUsageBoundary(event, "unknown"),
            ),
          );
        }
      : undefined,
    onToolCallBoundary: persist
      ? (event) => {
          const id = runtimeToolCallId(event?.tool_use_id);
          childToolExecs.set(id, {
            tool: event?.tool || "?",
            startedAt: deps.now ? deps.now() : Date.now(),
          });
          persistRuntimeLedgerWrite(() =>
            store.appendEvent(sessionId, "tool_call_started", {
              id,
              tool: event?.tool || "?",
            }),
          );
        }
      : undefined,
    onToolCallSettlement: persist
      ? (event) => {
          const id = runtimeToolCallId(event?.tool_use_id);
          const started = childToolExecs.get(id);
          childToolExecs.delete(id);
          persistRuntimeLedgerWrite(() =>
            store.appendToolCallCompact(sessionId, {
              id,
              tool: event?.tool || started?.tool || "?",
              isError: Boolean(event?.error || event?.result?.error),
              skill: event?.attribution?.skill,
              invocationReceipt: event?.result?.invocationReceipt,
              durationMs: started
                ? Math.max(
                    0,
                    (deps.now ? deps.now() : Date.now()) - started.startedAt,
                  )
                : undefined,
            }),
          );
        }
      : undefined,
    strictUsageTelemetry: persist,
    onStall: (ms, timeoutMs) => {
      const silent = Math.round(ms / 1000);
      const retryIn = timeoutMs > ms ? Math.round((timeoutMs - ms) / 1000) : 0;
      const suffix = retryIn > 0 ? ` · will retry in ${retryIn}s` : "";
      writeErr(`  ⏳ waiting for API response (silent ${silent}s)${suffix}…\n`);
    },
    onProviderFallback: (info) => {
      if (isStream) {
        emitStream({
          type: "raw",
          subtype: "provider_fallback",
          text:
            info.message || `provider switched from ${info.from} to ${info.to}`,
          from: info.from,
          to: info.to,
          reason: info.reason,
          session_id: sessionId,
        });
      } else {
        writeErr(
          `[provider] ${info.message || `switched from ${info.from} to ${info.to}`}\n`,
        );
      }
    },
  };

  // Goal binding (cc goal, Phase 1). `--goal <id>` binds explicitly; `--goal`
  // with no value (options.goal === true) auto-resolves from active/session.
  // When omitted, headless stays goal-free (no behavior change). Best-effort:
  // a failure here must never fail the run.
  let boundGoalId = null;
  if (options.goal !== undefined && options.goal !== false) {
    try {
      const explicitId = typeof options.goal === "string" ? options.goal : null;
      const { resolveActiveGoal, linkSession } =
        await import("../lib/goal-store.js");
      const goal = (deps.resolveActiveGoal || resolveActiveGoal)({
        explicitId,
        sessionId,
      });
      if (goal) {
        const { goalPrepareCall } = await import("../lib/goal-context.js");
        loopOptions.prepareCall = goalPrepareCall(goal);
        boundGoalId = goal.id;
        // Link the session so a later `--continue`/`--resume` keeps this goal.
        if (explicitId && persist !== false) {
          try {
            linkSession(goal.id, sessionId);
          } catch {
            /* linking is optional polish — never fatal */
          }
        }
      }
    } catch {
      /* goal binding is best-effort — proceed without it */
    }
  }

  // --max-budget-usd: a hard USD spend cap (Claude-Code parity). Accumulates
  // per-call cost from token-usage events and stops the loop before the next
  // paid call once the cap is reached. null → no cap (unchanged behavior).
  // Track priced usage even when no hard cap is configured so every machine
  // readable terminal result can carry authoritative cost evidence.  A null
  // limit never warns or stops the run; it only accumulates the same estimates
  // that an enabled --max-budget-usd guard would use.
  const costBudget = new CostBudget({
    limitUsd: options.maxCostUsd,
    table: options.priceTable,
  });

  const startedAt = deps.now ? deps.now() : Date.now();
  const toolCalls = [];
  // The core normally attaches a precise toolTelemetryRecord on success.
  // Keep an event-boundary fallback for denials/early throws that settle
  // before that record is produced. Read-only batches can run concurrently,
  // so timestamps and result pairing are keyed by provider tool-call id.
  const activeToolCalls = new Map();
  const toolStartedAt = new Map();
  // Policy denials (blocked tool calls) collected for an end-of-run summary,
  // so a non-interactive run surfaces what got blocked the way the REPL's
  // `/permissions denials` does (Claude-Code 2.1.193 denial reasons).
  const denials = [];
  const compactionDegradations = [];
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  let finalText = "";
  let endReason = "complete";
  let stopForCost = false;
  let stopForCompactionUsageUnknown = false;

  const emitStream = (obj) => {
    if (isStream) writeOut(JSON.stringify(obj) + "\n");
  };
  if (hookEventBacklogExhausted) {
    // Do not emit a partial pre-manifest hook projection. The fixed diagnostic
    // contains no event payload, hook output, command, path, or user content.
    writeOut(
      JSON.stringify({
        type: "result",
        subtype: "error_host_resource_budget",
        is_error: true,
        code: HOST_EVENT_BACKLOG_CODE,
        error: HOST_EVENT_BACKLOG_ERROR,
      }) + "\n",
    );
    writeErr(`${HOST_EVENT_BACKLOG_CODE}: event backlog limit reached\n`);
    disposePendingHookEvents();
    return {
      exitCode: 1,
      result: HOST_EVENT_BACKLOG_ERROR,
      isError: true,
    };
  }
  writeHookEvent = (event) => emitStream(event);

  // --include-partial-messages: forward live assistant-text deltas as
  // `stream_event` NDJSON lines (Claude-Code parity). Only meaningful for
  // stream-json output, where the agent loop's onToken hook feeds chunks as
  // they arrive from a streaming provider.
  if (isStream && options.includePartialMessages) {
    loopOptions.onToken = (text) =>
      emitStream({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        },
      });
  }

  emitStream({
    type: "system",
    subtype: "init",
    // Deterministic-headless manifest (gap-analysis 2026-07-11): protocol
    // version + persistence + live sources + policy/tool digests so CI can
    // assert the run shape. Mirrors agent-sdk PROTOCOL_VERSION.
    protocol_version: STREAM_PROTOCOL_VERSION,
    session_id: sessionId,
    session_persistence: persist,
    model,
    provider,
    permission_mode: options.permissionMode || "default",
    tools: enabledToolNames,
    tools_hash: computeToolsHash(enabledToolNames),
    policy_digest: computePolicyDigest({
      permissionMode: options.permissionMode,
      allowedTools: options.allowedTools,
      disallowedTools: options.disallowedTools,
      permissionRules,
    }),
    loaded_sources: buildLoadedSources({
      permissionRules,
      settingsHooks,
      mcp: Boolean(mcp),
      enabledToolNames,
    }),
    ...(Array.isArray(mcp?.mcpServerErrors) && mcp.mcpServerErrors.length > 0
      ? { mcp_server_errors: mcp.mcpServerErrors }
      : {}),
    // True isolation level for tool subprocesses: os-sandbox (bwrap) /
    // container (docker) / policy-only (no sandbox — rules are pre-execution).
    isolation_level: isolationLevel(options.sandbox),
    max_turns: budget.limit,
    resumed_from: resumeId,
    history_messages: history.length,
    additional_directories: additionalDirectories,
    goal_id: boundGoalId,
  });
  // Setup/prompt-expansion hooks can run before the stream manifest is ready.
  // Keep the protocol ordered by emitting their queued projection immediately
  // after `system:init`, never before it.
  while (pendingHookEvents.length > 0) {
    const queued = pendingHookEvents.shift();
    try {
      writeHookEvent(queued.event);
    } finally {
      // The event is no longer buffered once its wire projection is written.
      // Keep the host slot only for queue residency, never for renderer I/O.
      queued.lease.release();
    }
  }

  // --auto-rewake: after a turn finishes, run the async Stop hooks and, if an
  // `asyncRewake` check FAILED, append its report as a new user turn and re-run
  // the agent to fix it — bounded by `maxRewakes` (default 1). OPT-IN: when off
  // (the default), rewakeBudget is 0 and the loop below runs exactly once, so
  // one-shot `cc agent -p` behavior is byte-for-byte unchanged and no script is
  // surprised by a silent re-run. `_asyncStopHandled` tells the finally the
  // async Stop hooks already fired here so they aren't fired twice.
  const autoRewake = options.autoRewake === true;
  let rewakeBudget = autoRewake
    ? Number.isFinite(options.maxRewakes)
      ? options.maxRewakes
      : 1
    : 0;
  let _asyncStopHandled = false;
  const _settleAsyncStop = async () => {
    if (!settingsHooks || !_hookSupervisor) return { rewakes: [], results: [] };
    const { runObserveHooks } = await import("../lib/settings-hook-events.js");
    await runObserveHooks(
      settingsHooks,
      "Stop",
      { reason: endReason, cwd, session_id: sessionId },
      { cwd, supervisor: _hookSupervisor },
    );
    const waitMs = Number.isFinite(options.asyncHookWaitMs)
      ? options.asyncHookWaitMs
      : 5000;
    const started = Date.now();
    while (
      _hookSupervisor.runningCount() > 0 &&
      Date.now() - started < waitMs
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return {
      rewakes: _hookSupervisor.drainRewakes(),
      results: _hookSupervisor.drainResults(),
    };
  };

  // --goal-condition: session-level completion-condition engine (P1). After each
  // outer turn an independent checker judges a completion CONDITION; if unmet and
  // budget remains, a follow-up user turn re-drives the agent — until met
  // (goal_completed) or a budget is exhausted (goal_exhausted). OPT-IN: when
  // unset, `goalEngine` is null and the outer loop runs exactly once, so one-shot
  // `cc agent -p` behavior is byte-for-byte unchanged.
  let goalEngine = null;
  let _goalHelpers = null;
  let _goalTokensSeen = 0; // per-turn usage deltas (engine totals == run total)
  let _goalCostSeen = 0;
  // Model-judged conditions reuse the run's own model as an independent
  // evaluator (mirrors --goal-assess). Overridable via deps for tests.
  const _defaultGoalJudge = async (cond, transcript) => {
    const { chatWithTools } = await import("./agent-core.js");
    const { firstBalancedJson } = await import("../lib/json-schema-output.js");
    const judgePrompt =
      `You are judging whether a coding session met a completion condition.\n` +
      `Condition: ${cond.text || cond.source}\n\n` +
      `Latest assistant output:\n${String(transcript.finalText || "").slice(0, 2000)}\n\n` +
      `Reply with STRICT JSON only: {"met": true|false, "reason": "<short>"}.`;
    const r = await runMeteredDirectModelCall({
      sessionId: resolveHeadlessMeteredSessionId(persist, sessionId),
      persist: persist
        ? (type, data) => store.appendEvent(sessionId, type, data)
        : null,
      provider,
      model,
      source: "model",
      sessionBudget: options.sessionBudget || null,
      call: () =>
        chatWithTools([{ role: "user", content: judgePrompt }], {
          model,
          provider,
          baseUrl,
          apiKey,
          enabledToolNames: [],
        }),
    });
    const text = r?.message?.content || "";
    let met = false;
    let reason = "model judge returned no verdict";
    const block = firstBalancedJson(text, "{");
    if (block) {
      try {
        const parsed = JSON.parse(block);
        met = parsed.met === true;
        if (typeof parsed.reason === "string" && parsed.reason.trim())
          reason = parsed.reason.trim();
        else reason = met ? "condition met" : "condition not met";
      } catch {
        /* tolerant: a non-JSON verdict stays unmet */
      }
    }
    return {
      met,
      reason,
      evidence: { kind: "model", raw: text.slice(0, 200) },
    };
  };
  // Persist the engine snapshot as a hash-chained `goal_snapshot` session event
  // (best-effort, only when persisting). Re-read on --resume so an unfinished
  // goal continues across processes with its outerTurns/tokens/cost/startedAtMs
  // intact. rebuildMessages ignores this event type, so it never pollutes model
  // context. Defined here so the outer loop can call it after each evaluate().
  const persistGoalSnapshot = () => {
    if (!persist || !goalEngine) return;
    try {
      store.appendEvent(sessionId, "goal_snapshot", goalEngine.snapshot());
    } catch {
      // best-effort — never fail the run over persistence
    }
  };
  if (options.goalCondition) {
    try {
      const eng = await import("../lib/goal-condition-engine.js");
      const goalNow = () => (deps.now ? deps.now() : Date.now());
      // Cross-process resume: if the resumed session persisted an UNFINISHED
      // goal, continue it (fromSnapshot keeps accumulated progress + startedAtMs)
      // rather than starting fresh. A finished (done) snapshot is ignored — the
      // prior goal already concluded, so --goal-condition begins a new cycle. On
      // restore the persisted condition/budget win over freshly-passed flags, so
      // a resume faithfully continues the same goal.
      let restoredSnap = null;
      if (resumeId) {
        try {
          const event = store.findLatestEvent(resumeId, "goal_snapshot");
          const snap = event?.data;
          if (snap && snap.state && snap.state.done !== true) {
            restoredSnap = snap;
          }
        } catch {
          restoredSnap = null; // unreadable transcript → start fresh
        }
      }
      if (restoredSnap) {
        goalEngine = eng.GoalConditionEngine.fromSnapshot(restoredSnap, {
          now: goalNow,
        });
      } else {
        goalEngine = new eng.GoalConditionEngine({
          condition: options.goalCondition,
          budget: {
            maxOuterTurns: options.maxOuterTurns,
            maxTokens: options.goalMaxTokens,
            maxCostUsd: options.goalMaxCostUsd,
            maxTimeMs: options.goalMaxTimeMs,
          },
          now: goalNow,
        });
      }
      _goalHelpers = {
        isDeterministicCondition: eng.isDeterministicCondition,
        runDeterministicCheck: eng.runDeterministicCheck,
        GOAL_DECISION: eng.GOAL_DECISION,
      };
      const started = goalEngine.start();
      emitStream({
        type: started.type,
        condition: started.condition,
        budget: started.budget,
        resumed: Boolean(restoredSnap),
      });
      persistGoalSnapshot(); // checkpoint the starting/restored state
      if (isText)
        writeErr(
          `  ◎ goal-condition ${restoredSnap ? "resumed" : "active"}: ` +
            `${goalEngine.condition.source} ` +
            `(outer turn ${goalEngine.state.outerTurns + 1}/` +
            `${goalEngine.budget.maxOuterTurns})\n`,
        );
    } catch (err) {
      // A bad spec should have been rejected at the command layer; fail-open so
      // a malformed condition never aborts an otherwise-valid run.
      goalEngine = null;
      if (isText) writeErr(`  goal-condition ignored: ${err.message}\n`);
    }
  }

  // A Ctrl-C (SIGINT) / SIGTERM terminates Node WITHOUT unwinding the `finally`
  // below, so its background-task reaper is bypassed — a backgrounded run_shell
  // task (e.g. a dev server) this run spawned would be orphaned. Install a
  // scoped handler that reaps it synchronously + stops the async-hook
  // supervisor, then exits with the conventional 128+signal code. Headless has
  // no other SIGINT owner (no raw-mode keypress like the REPL), so this can't
  // race a competing handler. Removed in `finally` so a normal return leaves no
  // listener behind (runAgentHeadless can be called repeatedly in one process).
  const _onHardSignal = (sig) => {
    if (!hermeticExecution) {
      try {
        killAllBackgroundShellTasksSync();
      } catch {
        /* best-effort — never let cleanup throw during shutdown */
      }
    }
    try {
      if (_hookSupervisor) _hookSupervisor.stopAll();
    } catch {
      /* best-effort */
    }
    process.exit(sig === "SIGTERM" ? 143 : 130);
  };
  process.once("SIGINT", _onHardSignal);
  process.once("SIGTERM", _onHardSignal);

  let loopFailureOutcome = null;
  let cleanupFailure = null;
  try {
    while (true) {
      sessionHostLease?.assert?.();
      // P1 turn→checkpoint binding: one drain of the loop = one turn. Anchor
      // the conversation offset before the model sees the new user turn. A
      // `--worktree` run stamps its isolation worktree (branch name, threaded
      // from the command layer) onto each turn record.
      if (turnBindingFeed) {
        turnBindingFeed.beginTurn(messages.length, {
          worktreeId: options.worktreeId ?? null,
        });
      }
      for await (const event of runLoop(messages, loopOptions)) {
        if (evolutionIngress !== null) {
          await evolutionIngress.ingestAgentEvent(event);
        }
        if (turnBindingFeed) turnBindingFeed.handleEvent(event);
        switch (event.type) {
          case "managed-checkpoint":
          case "managed-checkpoint-settled":
          case "managed-checkpoint-error": {
            const line = formatManagedCheckpointEvent(event);
            if (isText && line) writeErr(`${line}\n`);
            if (isStream) emitStream(event);
            break;
          }
          case "checkpoint": {
            if (isText)
              writeErr(`  ⎌ checkpoint ${event.id} (before ${event.tool})\n`);
            emitStream({
              type: "checkpoint",
              id: event.id,
              tool: event.tool,
            });
            break;
          }
          case "tool-executing": {
            const telemetryToolId = runtimeToolCallId(event.tool_use_id);
            const line = `  [${event.tool}] ${formatToolArgs(event.tool, event.args)}`;
            if (isText) writeErr(line + "\n");
            emitStream({
              type: "tool_use",
              ...(event.tool_use_id ? { id: event.tool_use_id } : {}),
              tool: event.tool,
              args: event.args,
            });
            const toolCall = {
              id: telemetryToolId,
              tool: event.tool,
              args: event.args,
            };
            toolCalls.push(toolCall);
            toolStartedAt.set(
              telemetryToolId,
              deps.now ? deps.now() : Date.now(),
            );
            if (event.tool_use_id) {
              activeToolCalls.set(event.tool_use_id, toolCall);
            }
            if (persist) {
              persistRuntimeLedgerWrite(() =>
                store.appendEvent(sessionId, "tool_call_started", {
                  id: telemetryToolId,
                  tool: event.tool,
                }),
              );
            }
            // P0-2: record an irreversible effect as STARTED (persisted before
            // it settles) so a crash before the matching tool-result leaves a
            // reconcilable "in flight" marker instead of a silent replay.
            currentSideEffectOpId = null;
            if (persist) {
              const se = classifyToolSideEffect(event.tool, event.args);
              if (se) {
                const opId = `${sideEffectRunNonce}:${sideEffectSeq++}`;
                currentSideEffectOpId = opId;
                sideEffectLedger
                  .prepare(opId, {
                    kind: se.kind,
                    key: se.key,
                    // Content-addressed key: a resumed replay of the SAME effect
                    // derives the SAME key, so an external provider can de-dupe
                    // and countDuplicateCommittedEffects can measure `0` repeats.
                    meta: {
                      tool: event.tool,
                      toolUseId: telemetryToolId,
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
                persistSideEffectLedger();
                // The generator executes the tool only after this yielded
                // prewrite is handled. Recheck the same durable lease at that
                // final host boundary so a fenced host never resumes into the
                // external operation.
                sessionHostLease?.assert?.();
              }
            }
            break;
          }
          case "tool-result": {
            const err = event.error || event.result?.error || null;
            // P0-2: settle the in-flight side-effect (commit on success, fail on
            // a clean error) and persist the updated ledger snapshot.
            if (persist && currentSideEffectOpId) {
              if (event.permission_decision) {
                sideEffectLedger.annotate(currentSideEffectOpId, {
                  permissionDecision: event.permission_decision,
                });
              }
              if (event.result?._diffReviewAudit) {
                diffReviewFollowUps.observe(
                  sideEffectLedger,
                  currentSideEffectOpId,
                  event.result._diffReviewAudit,
                );
              }
              if (err)
                sideEffectLedger.fail(
                  currentSideEffectOpId,
                  String(err).slice(0, 200),
                );
              else sideEffectLedger.commit(currentSideEffectOpId);
              persistSideEffectLedger();
              currentSideEffectOpId = null;
            }
            if (isText && err) writeErr(`  Error: ${err}\n`);
            emitStream({
              type: "tool_result",
              ...(event.tool_use_id ? { id: event.tool_use_id } : {}),
              tool: event.tool,
              is_error: Boolean(err),
              error: err,
              result: event.result,
              ...(event.permission_decision_id
                ? { permission_decision_id: event.permission_decision_id }
                : {}),
              ...(event.permission_decision
                ? { permission_decision: event.permission_decision }
                : {}),
            });
            if (includeHookEvents) {
              const policyEvent = projectToolPolicyDecision(event, {
                sessionId,
                turnId: event.turn_id,
                toolUseId: event.tool_use_id,
              });
              if (policyEvent) emitStream(policyEvent);
            }
            const settledCall =
              (event.tool_use_id
                ? activeToolCalls.get(event.tool_use_id)
                : null) ||
              [...toolCalls]
                .reverse()
                .find(
                  (call) =>
                    !call._runtimeSettled &&
                    (!event.tool || call.tool === event.tool),
                ) ||
              null;
            if (settledCall) {
              settledCall.is_error = Boolean(err);
              settledCall.durationMs =
                event.result?.toolTelemetryRecord?.durationMs ??
                (toolStartedAt.get(settledCall.id) === undefined
                  ? undefined
                  : Math.max(
                      0,
                      (deps.now ? deps.now() : Date.now()) -
                        toolStartedAt.get(settledCall.id),
                    ));
              Object.assign(
                settledCall,
                extractPluginUsageAttribution(event.result),
              );
              Object.defineProperty(settledCall, "_runtimeSettled", {
                configurable: true,
                value: true,
              });
              toolStartedAt.delete(settledCall.id);
              if (event.tool_use_id) activeToolCalls.delete(event.tool_use_id);
            }
            if (persist && settledCall) {
              persistRuntimeLedgerWrite(() =>
                store.appendToolCallCompact(sessionId, {
                  id: settledCall.id || `tool-${toolCalls.length}`,
                  tool: settledCall.tool,
                  isError: Boolean(settledCall.is_error),
                  skill:
                    settledCall.tool === "run_skill"
                      ? settledCall.args?.skill_name || null
                      : undefined,
                  plugin: settledCall.plugin || undefined,
                  pluginVersion: settledCall.pluginVersion || undefined,
                  durationMs: settledCall.durationMs,
                  invocationReceipt: event.result?.invocationReceipt,
                }),
              );
            }
            // Track policy denials (not plain tool failures) for the end-of-run
            // summary. The preceding tool-executing pushed the args.
            if (err) {
              const denial = classifyDenial({
                tool: event.tool,
                result: event.result,
                error: event.error,
                argsSummary:
                  settledCall && settledCall.tool === event.tool
                    ? formatToolArgs(event.tool, settledCall.args)
                    : "",
              });
              if (denial) {
                recordDenial(denials, {
                  ...denial,
                  at: deps.now ? deps.now() : Date.now(),
                });
              }
            }
            break;
          }
          case "compaction-degraded": {
            const reason = String(event.reason || "semantic-summary-degraded")
              .replace(/\s+/g, " ")
              .slice(0, 500);
            const degradation = {
              reason,
              summary_mode: event.summaryMode || "none",
            };
            compactionDegradations.push(degradation);
            if (isText) {
              writeErr(
                `  Semantic compaction degraded to ${degradation.summary_mode}: ${reason}\n`,
              );
            }
            emitStream({ ...event, reason });
            break;
          }
          case "model-usage-started": {
            if (persist && event.ledgerPersisted !== true) {
              persistRuntimeLedgerWrite(() =>
                store.appendEvent(
                  sessionId,
                  runtimeUsageEventType("started"),
                  projectRuntimeUsageBoundary(event, "started"),
                ),
              );
            }
            beginSessionBudgetUsage(
              options.sessionBudget,
              event,
              "headless provider call",
            );
            break;
          }
          case "model-usage-unknown":
          case "compaction-usage-unknown": {
            if (persist && event.ledgerPersisted !== true) {
              persistRuntimeLedgerWrite(() =>
                store.appendEvent(
                  sessionId,
                  runtimeUsageEventType("unknown"),
                  projectRuntimeUsageBoundary(event, "unknown"),
                ),
              );
            }
            const budgetUsageUnknown = markSessionBudgetUsageUnknown(
              options.sessionBudget,
              event,
            );
            if (event.type === "compaction-usage-unknown") {
              endReason = "compaction-usage-unknown";
              stopForCompactionUsageUnknown = true;
              emitStream({
                type: "compaction_usage_unknown",
                provider: event.provider,
                model: event.model,
                source: event.source || "semantic-compaction",
                reason: event.reason || "provider_transport_outcome_unknown",
                usage_outcome: "unknown",
              });
            }
            if (budgetUsageUnknown) {
              rejectSessionBudgetUsageUnknown(
                event,
                event.type === "compaction-usage-unknown"
                  ? "headless semantic compaction"
                  : "headless provider call",
              );
            }
            break;
          }
          case "token-usage": {
            const persistedUsage = projectRuntimeTokenUsage(event);
            if (persist && event.ledgerPersisted !== true) {
              persistRuntimeLedgerWrite(() =>
                store.appendTokenUsage(sessionId, persistedUsage),
              );
            }
            recordSessionBudgetUsage(
              options.sessionBudget,
              event,
              "headless usage settlement",
            );
            if (!event.attribution) {
              usage.input_tokens += event.usage?.input_tokens || 0;
              usage.output_tokens += event.usage?.output_tokens || 0;
              // Carry prompt-cache tokens into accumulated usage (cost accuracy).
              usage.cache_read_input_tokens +=
                event.usage?.cache_read_input_tokens || 0;
              usage.cache_creation_input_tokens +=
                event.usage?.cache_creation_input_tokens || 0;
            }
            emitStream({
              type: "token_usage",
              provider: event.provider,
              model: event.model,
              usage: event.usage,
              ...(event.source ? { source: event.source } : {}),
            });
            if (costBudget) {
              costBudget.add({
                provider: event.provider,
                model: event.model,
                usage: event.usage,
              });
              if (costBudget.shouldWarnInactive()) {
                const m = `cost cap $${options.maxCostUsd} set but model "${event.model}" is unpriced/free — cap inactive`;
                if (isText) writeErr(`  ${m}\n`);
                emitStream({ type: "cost_warning", message: m });
              }
              if (costBudget.exceeded()) {
                endReason = "cost-budget-exhausted";
                stopForCost = true;
                if (isText)
                  writeErr(
                    `  ⛔ cost budget $${options.maxCostUsd} reached (spent ≈$${costBudget.spentUsd}) — stopping\n`,
                  );
                emitStream({
                  type: "cost_budget_exhausted",
                  limit_usd: options.maxCostUsd,
                  spent_usd: costBudget.spentUsd,
                });
              }
            }
            break;
          }
          case "iteration-warning": {
            if (isText) writeErr(`  ${event.message}\n`);
            emitStream({ type: "iteration_warning", message: event.message });
            break;
          }
          case "iteration-budget-exhausted": {
            endReason = "max_turns";
            emitStream({
              type: "iteration_budget_exhausted",
              budget: event.budget,
            });
            break;
          }
          case "response-complete": {
            finalText = event.content || "";
            if (
              persist &&
              diffReviewFollowUps.complete(sideEffectLedger, {
                status: "completed-without-reproposal",
              }).length > 0
            ) {
              persistSideEffectLedger();
            }
            break;
          }
          case "run-ended": {
            if (event.reason) endReason = event.reason;
            if (
              persist &&
              diffReviewFollowUps.complete(sideEffectLedger, {
                status:
                  event.reason === "complete"
                    ? "completed-without-reproposal"
                    : "interrupted",
                reason: event.reason || endReason,
              }).length > 0
            ) {
              persistSideEffectLedger();
            }
            break;
          }
          default:
            // slot-filling, run-started, etc. — surfaced only in stream mode.
            if (isStream && event.type) emitStream(event);
            break;
        }
        await deps.outputFlow?.wait?.();
        // Hard cost cap reached: stop consuming the loop so no further paid LLM
        // call is made (break out of the for-await, not just the switch).
        if (stopForCost || stopForCompactionUsageUnknown) break;
      }
      // P1 turn→checkpoint binding: the turn settled — persist the explicit
      // table (latest snapshot wins on load; no-op when nothing was recorded).
      persistTurnBindingLog();
      // ── auto-rewake re-drive (opt-in via --auto-rewake) ─────────────────
      // Under auto-rewake, settle the async Stop hooks after EVERY turn (so the
      // final turn's background check still runs). If an asyncRewake check
      // failed and re-drive budget remains, append its report as a new user
      // turn and loop; if a rewake failed but budget is spent, surface it and
      // stop. When auto-rewake is off, this whole block is skipped and the
      // `finally` handles Stop exactly as before (default behavior unchanged).
      if (
        autoRewake &&
        _hookSupervisor &&
        !stopForCost &&
        endReason !== "max_turns" &&
        endReason !== "cost-budget-exhausted"
      ) {
        const { rewakes, results } = await _settleAsyncStop();
        _asyncStopHandled = true;
        for (const rs of results) {
          if (rs.additionalContext)
            writeErr(`[async-hook] ${rs.command}: ${rs.additionalContext}\n`);
        }
        if (rewakes.length > 0 && rewakeBudget > 0) {
          rewakeBudget--;
          const detail = rewakes
            .map(
              (rw) =>
                `- ${rw.command} failed` +
                `${rw.exitCode != null ? ` (exit ${rw.exitCode})` : ""}` +
                `${rw.error ? `: ${rw.error}` : ""}`,
            )
            .join("\n");
          messages.push({
            role: "user",
            content:
              `A background check flagged a problem after your last turn:\n${detail}\n` +
              `Investigate and fix it, then confirm it passes.`,
          });
          if (isText)
            writeErr(
              `  ↻ async-hook rewake — re-engaging agent (${rewakeBudget} re-drive(s) left)\n`,
            );
          emitStream({ type: "rewake", remaining: rewakeBudget });
          finalText = "";
          endReason = "complete";
          continue; // re-drive: run another agent turn
        }
        // A rewake fired but no budget remains — surface it (couldn't auto-fix).
        for (const rw of rewakes) {
          writeErr(
            `[async-hook REWAKE] ${rw.command} failed` +
              `${rw.exitCode != null ? ` (exit ${rw.exitCode})` : ""}` +
              `${rw.error ? `: ${rw.error}` : ""}\n`,
          );
        }
      }
      // ── goal-condition re-drive (opt-in via --goal-condition) ─────────────
      // After the turn settles (and any auto-rewake fix), evaluate the session
      // completion condition. Unmet + budget remaining → append a follow-up user
      // turn and re-drive; met → goal_completed; budget spent → goal_exhausted.
      // Cost / max-turns exhaustion of the INNER loop stops here regardless.
      if (
        goalEngine &&
        _goalHelpers &&
        !goalEngine.done &&
        !stopForCost &&
        endReason !== "cost-budget-exhausted" &&
        endReason !== "max_turns"
      ) {
        // Feed this turn's usage DELTA so the engine's totals equal the run's
        // cumulative usage (recordTurnUsage accumulates).
        const curTokens =
          usage.input_tokens +
          usage.output_tokens +
          usage.cache_read_input_tokens +
          usage.cache_creation_input_tokens;
        const curCost = costBudget ? Number(costBudget.spentUsd) || 0 : 0;
        goalEngine.recordTurnUsage({
          tokens: curTokens - _goalTokensSeen,
          costUsd: curCost - _goalCostSeen,
        });
        _goalTokensSeen = curTokens;
        _goalCostSeen = curCost;

        const cond = goalEngine.condition;
        let evaluation;
        try {
          if (_goalHelpers.isDeterministicCondition(cond)) {
            const gc = deps.goalCheck || {};
            const spawnSync = gc.spawnSync || runHeadlessGoalCommand;
            const existsSync =
              gc.existsSync || (await import("node:fs")).existsSync;
            evaluation = _goalHelpers.runDeterministicCheck(cond, {
              spawnSync,
              existsSync,
              cwd,
              lastOutput: finalText,
            });
          } else {
            const judge = deps.goalConditionJudge || _defaultGoalJudge;
            evaluation = await judge(cond, {
              prompt: options.prompt,
              finalText,
              toolCalls,
            });
          }
        } catch (err) {
          if (err?.runtimeLedgerPersistence === true) throw err;
          evaluation = {
            met: false,
            reason: `goal check failed: ${err.message}`,
            evidence: { error: true },
          };
        }

        const { decision, events } = goalEngine.evaluate(evaluation);
        for (const ev of events) {
          emitStream(ev);
          if (isText) {
            if (ev.type === "goal_completed")
              writeErr(`  ✔ goal-condition met: ${ev.reason}\n`);
            else if (ev.type === "goal_exhausted")
              writeErr(
                `  ⛔ goal-condition unmet (${ev.limit}): ${ev.reason}\n`,
              );
            else if (ev.type === "goal_evaluated")
              writeErr(
                `  ◎ goal-condition ${ev.met ? "met" : "not met"}: ${ev.reason}\n`,
              );
          }
        }
        // Checkpoint the post-evaluate state (outerTurns incremented, and
        // done/outcome on a terminal decision) so a crash or Ctrl-C between here
        // and the next turn still resumes at the right point.
        persistGoalSnapshot();
        if (decision === _goalHelpers.GOAL_DECISION.CONTINUE) {
          messages.push({
            role: "user",
            content:
              `The completion condition is not yet met: ${evaluation.reason}.\n` +
              `Keep working toward: "${cond.source}". When you believe it is ` +
              `satisfied, make sure it actually passes.`,
          });
          finalText = "";
          endReason = "complete";
          if (isText)
            writeErr(
              `  ↻ goal-condition re-drive — outer turn ${goalEngine.state.outerTurns + 1}\n`,
            );
          continue; // re-drive: run another outer turn
        }
        // complete | exhausted → fall through to the break below.
      }
      break;
    }
  } catch (err) {
    const runtimeLedgerPersistenceFailed =
      err?.runtimeLedgerPersistence === true;
    const sessionBudgetFailed =
      err?.code === "CC_SESSION_BUDGET_EXHAUSTED" ||
      err?.code === "CC_SESSION_BUDGET_USAGE_UNKNOWN" ||
      options.sessionBudget?.signal?.aborted === true;
    const message = runtimeLedgerPersistenceFailed
      ? RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE
      : err?.code === "CC_SESSION_BUDGET_USAGE_UNKNOWN"
        ? err.message
        : sessionBudgetFailed
          ? sessionBudgetAdmissionError(
              options.sessionBudget?.reason?.() || err?.budgetReason,
              "run",
            ).message
          : err?.message || String(err);
    const errorSubtype = runtimeLedgerPersistenceFailed
      ? "error_persistence"
      : sessionBudgetFailed
        ? "error_session_budget"
        : "error";
    if (isStream) {
      emitStream({
        type: "result",
        subtype: errorSubtype,
        is_error: true,
        error: message,
      });
    } else if (isJson) {
      writeOut(
        JSON.stringify(
          buildResultEnvelope({
            subtype: errorSubtype,
            isError: true,
            result: message,
            sessionId,
            toolCalls,
            usage,
            numTurns: budget.consumed,
            durationMs: (deps.now ? deps.now() : Date.now()) - startedAt,
            denials,
            compactionDegradations,
          }),
        ) + "\n",
      );
    } else {
      writeErr(`Error: ${message}\n`);
    }
    // Provider/transport failures get their own exit code (5) so CI can tell
    // "the model call failed" from "the run itself errored" (1).
    loopFailureOutcome = {
      exitCode:
        runtimeLedgerPersistenceFailed || sessionBudgetFailed
          ? 1
          : classifyLoopError(err),
      result: message,
      isError: true,
    };
  } finally {
    // Capture body-cache hits/misses caused by list_skills/run_skill during the
    // turn. `cc context --sources` reads the newest snapshot.
    persistContextSources();
    await cleanupDeadline.run("background-interaction", () =>
      _backgroundInteraction?.close?.(),
    );
    // Drop the signal handlers first — a normal return must not leave a
    // process-wide SIGINT/SIGTERM listener behind (a later Ctrl-C would wrongly
    // exit with 130, and repeated in-process runs would leak listeners).
    process.removeListener("SIGINT", _onHardSignal);
    process.removeListener("SIGTERM", _onHardSignal);
    // Tear down ad-hoc MCP servers (--mcp-config) before returning, whether the
    // loop completed or threw. Best-effort: a failed disconnect never masks the
    // run's own outcome.
    await cleanupDeadline.run("mcp", () => mcp?.mcpClient?.disconnectAll?.());
    // Kill any background run_shell tasks this run spawned so a backgrounded
    // command (e.g. a dev server) doesn't outlive the headless invocation.
    if (!hermeticExecution) {
      await cleanupDeadline.run("background-shells", () =>
        killAllBackgroundShellTasks(),
      );
    }
    // Tear down the --remote-control approval bridge + its self-hosted WS
    // server so the run's port/socket never outlives the invocation.
    await cleanupDeadline.run("remote-approval", () =>
      _remoteApproval?.close?.(),
    );
    approvalGate?.setAuthorizationConsumer?.(null);
    // settings.json Stop + SessionEnd hooks when the run finishes. Stop is the
    // canonical async-hook trigger ("run the test suite at turn end"); fire its
    // async hooks fire-and-forget, then settle so a fast background check can
    // report back within this one-shot run.
    await cleanupDeadline.run("settings-hooks", async () => {
      if (settingsHooks) {
        try {
          const { runObserveHooks } =
            await import("../lib/settings-hook-events.js");
          const stopPayload = {
            reason: pipeState.closed ? "pipe_closed" : endReason,
            cwd,
            session_id: sessionId,
          };
          const stopOutcome = await runObserveHooks(
            settingsHooks,
            "Stop",
            stopPayload,
            { cwd, supervisor: _hookSupervisor },
          );
          const stopFailures = (stopOutcome?.results || []).filter(
            (result) =>
              result?.status === "error" ||
              result?.nonBlockingError === true ||
              result?.malformedDecision === true ||
              result?.breakerOpen === true,
          );
          if (stopFailures.length > 0) {
            emitHooksV2Event("StopFailure", {
              schema_version: 1,
              session_id: sessionId,
              phase: "stop-hook",
              failures: stopFailures.map((failure) => ({
                command: failure.command || null,
                exit_code: failure.exitCode ?? null,
                reason: failure.reason || failure.error || null,
              })),
            });
          }
          // Skip the async Stop dispatch/settle here if the auto-rewake re-drive
          // loop already fired + drained it this run (avoids double-execution).
          if (_hookSupervisor && !_asyncStopHandled) {
            // Bounded settle: wait for in-flight async hooks (Stop + any
            // PostToolUse dispatched during the loop) to finish, capped so a
            // slow/hung check can never stall the run. Default 5s; tunable.
            const waitMs = Number.isFinite(options.asyncHookWaitMs)
              ? options.asyncHookWaitMs
              : 5000;
            const started = Date.now();
            while (
              _hookSupervisor.runningCount() > 0 &&
              Date.now() - started < waitMs
            ) {
              await new Promise((r) => setTimeout(r, 50));
            }
            // Surface any results/rewakes out-of-band on stderr (never touches the
            // stdout envelope). A rewake means a background check FAILED and would
            // re-engage the agent in an interactive session — flag it clearly so a
            // headless caller/CI can react.
            for (const rw of _hookSupervisor.drainRewakes()) {
              emitHooksV2Event("StopFailure", {
                schema_version: 1,
                session_id: sessionId,
                phase: "async-stop-hook",
                command: rw.command || null,
                exit_code: rw.exitCode ?? null,
                reason: rw.error || "async stop hook requested rewake",
              });
              writeErr(
                `[async-hook REWAKE] ${rw.command} failed` +
                  `${rw.exitCode != null ? ` (exit ${rw.exitCode})` : ""}` +
                  `${rw.error ? `: ${rw.error}` : ""}\n`,
              );
            }
            for (const rs of _hookSupervisor.drainResults()) {
              if (rs.additionalContext) {
                writeErr(
                  `[async-hook] ${rs.command}: ${rs.additionalContext}\n`,
                );
              }
            }
          }
          // Always reap the supervisor (kills any straggler child + detaches the
          // exit reaper), whether the async Stop was handled here or in re-drive.
          if (_hookSupervisor) _hookSupervisor.stopAll();
          await runObserveHooks(
            settingsHooks,
            "SessionEnd",
            {
              reason: pipeState.closed ? "pipe_closed" : "completed",
              cwd,
              session_id: sessionId,
            },
            { cwd },
          );
        } catch (error) {
          emitHooksV2Event("StopFailure", {
            schema_version: 1,
            session_id: sessionId,
            phase: "stop-hook-dispatch",
            reason: error?.message || String(error),
          });
          // observe-only + best-effort async surfacing
        }
      }
    });
    disposePendingHookEvents();
    const cleanupReport = cleanupDeadline.report();
    try {
      deps.onCleanupReport?.(cleanupReport);
    } catch {
      // Metrics/reporting cannot change cleanup semantics.
    }
    if (cleanupReport.timedOut) {
      cleanupFailure = cleanupDeadlineError(cleanupReport);
    }
  }

  // Preserve the primary model/runtime failure. A simultaneous cleanup timeout
  // remains observable through onCleanupReport but must not replace it.
  if (loopFailureOutcome) return loopFailureOutcome;
  if (cleanupFailure) throw cleanupFailure;
  if (evolutionIngress !== null) {
    await evolutionIngress.complete();
  }

  // A downstream consumer closed stdout/stderr. The abort above unwound the
  // model loop through the same `finally` as every other termination, so MCP,
  // background tasks, approval bridges, and hooks are settled. Do not attempt
  // more writes to the closed pipe or persist a partial assistant answer.
  if (pipeState.closed) {
    return { exitCode: 0, result: finalText, isError: false };
  }

  // coreAgentLoop emits run-ended reason "budget-exhausted" when the iteration
  // cap is hit; treat that as the max-turns error surface. A cost-budget stop
  // (--max-budget-usd) is its own error surface so callers can tell them apart.
  const exhausted =
    endReason === "budget-exhausted" || endReason === "max_turns";
  const costStopped = endReason === "cost-budget-exhausted";
  let isError = exhausted || costStopped || endReason === "no-response";
  let subtype = exhausted
    ? "error_max_turns"
    : costStopped
      ? "error_max_budget"
      : isError
        ? "error"
        : "success";
  const durationMs = (deps.now ? deps.now() : Date.now()) - startedAt;
  let persistenceFailure = null;

  // Persist the assistant turn so a later --resume / --continue replays it.
  // The user turn was already recorded up front; only append on a clean run.
  if (persist && !isError) {
    try {
      if (finalText) store.appendAssistantMessage(sessionId, finalText);
    } catch (error) {
      const persistenceError = createSessionPersistenceFailure(error, {
        sessionId,
        operation: "assistant-turn-append",
      });
      persistenceFailure = projectSessionPersistenceFailure(persistenceError, {
        phase: "after-model",
      });
      if (persistenceFailure) {
        isError = true;
        subtype = "error_persistence";
        try {
          deps.onPersistenceFailure?.(persistenceFailure);
        } catch {
          // Observability cannot change persistence semantics.
        }
        if (isText) {
          writeErr(
            `CC_SESSION_PERSISTENCE_FAILED: assistant turn durability is ${persistenceFailure.commit_state} (${persistenceFailure.fs_code})\n`,
          );
        }
      }
      // Preserve legacy best-effort handling for errors outside the explicit
      // ENOSPC/EROFS durability contract.
    }
  }

  // Run-end goal self-assessment (cc goal Phase 2, opt-in via --goal-assess).
  // Spends one extra completion to judge whether the run advanced the bound
  // goal, then persists progress / key-result / drift updates. Ordinary
  // assessment failures are best-effort; a usage-ledger durability failure is
  // terminal because reporting the extra paid call as successful is unsafe.
  if (options.goalAssess && boundGoalId && !isError) {
    try {
      const { getGoal } = await import("../lib/goal-store.js");
      const goal = (deps.getGoal || getGoal)(boundGoalId);
      if (goal) {
        const { assessGoalProgress } = await import("../lib/goal-assess.js");
        const doAssess = deps.assessGoalProgress || assessGoalProgress;
        const assessChat =
          deps.assessChat ||
          (async (assessPrompt) => {
            const { chatWithTools } = await import("./agent-core.js");
            const r = await runMeteredDirectModelCall({
              sessionId: resolveHeadlessMeteredSessionId(persist, sessionId),
              persist: persist
                ? (type, data) => store.appendEvent(sessionId, type, data)
                : null,
              provider,
              model,
              source: "model",
              sessionBudget: options.sessionBudget || null,
              call: () =>
                chatWithTools([{ role: "user", content: assessPrompt }], {
                  model,
                  provider,
                  baseUrl,
                  apiKey,
                  enabledToolNames: [],
                }),
            });
            return r?.message?.content || "";
          });
        const { assessment } = await doAssess({
          goal,
          transcript: { prompt: options.prompt, finalText, toolCalls },
          chat: assessChat,
        });
        if (assessment) {
          if (isText) {
            writeErr(
              `  ◎ goal ${boundGoalId}: ${assessment.advanced ? "advanced" : "no progress"}` +
                (assessment.progress != null
                  ? ` (${assessment.progress}%)`
                  : "") +
                "\n",
            );
          }
          emitStream({
            type: "goal_assessment",
            goal_id: boundGoalId,
            advanced: assessment.advanced,
            progress: assessment.progress,
            note: assessment.note,
          });
        }
      }
    } catch (error) {
      if (error?.runtimeLedgerPersistence === true) {
        isError = true;
        subtype = "error_persistence";
        finalText = RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE;
        if (isText) {
          writeErr(`${RUNTIME_LEDGER_PERSISTENCE_FAILURE_MESSAGE}\n`);
        }
      }
      // Non-ledger assessment failures remain best-effort.
    }
  }

  // End-of-run policy-denial summary so a non-interactive run surfaces what was
  // blocked (mirrors the REPL's `/permissions denials`). Text → stderr lines;
  // stream → a `denials_summary` event before the final result.
  if (denials.length) {
    if (isText) {
      writeErr(
        `\n  ${denials.length} tool call(s) were denied by policy this run:\n` +
          formatDenials(denials, {
            now: deps.now ? deps.now() : Date.now(),
          }) +
          "\n",
      );
    } else if (isStream) {
      emitStream({ type: "denials_summary", count: denials.length, denials });
    }
    try {
      const { appendRecentDenials } =
        await import("../lib/permission-denial-store.js");
      appendRecentDenials(denials, {
        sessionId,
        permissionMode: options.permissionMode || "default",
        cwd,
        source: "headless",
      });
    } catch {
      // Persisting the review surface is best-effort; never affect the run.
    }
  }

  if (isStream) {
    emitStream({
      type: "result",
      subtype,
      is_error: isError,
      result: finalText,
      session_id: sessionId,
      num_turns: budget.consumed,
      duration_ms: durationMs,
      usage,
      total_cost_usd: costBudget.spentUsd,
      ...(compactionDegradations.length
        ? { compaction_degradations: compactionDegradations }
        : {}),
      ...(persistenceFailure ? { persistence: persistenceFailure } : {}),
    });
  } else if (isJson) {
    writeOut(
      JSON.stringify(
        buildResultEnvelope({
          subtype,
          isError,
          result: finalText,
          sessionId,
          toolCalls,
          usage,
          totalCostUsd: costBudget.spentUsd,
          numTurns: budget.consumed,
          durationMs,
          denials,
          compactionDegradations,
          persistence: persistenceFailure,
        }),
      ) + "\n",
    );
  } else {
    // text: just the final answer on stdout.
    writeOut(finalText + (finalText.endsWith("\n") ? "" : "\n"));
  }

  // Export once to each configured sink. Collector enqueue is durable and
  // best-effort; the process lifecycle force-flushes it before exit.
  if (_otlpRecorder) {
    if (options.otlp) {
      try {
        const fsp = await import("node:fs");
        fsp.writeFileSync(
          options.otlp,
          JSON.stringify(_otlpRecorder.toOtlp(), null, 2),
          "utf-8",
        );
        if (!isStream) {
          const sum = _otlpRecorder.summary();
          writeErr(`[otlp] ${sum.spanCount} span(s) → ${options.otlp}\n`);
        }
      } catch (err) {
        writeErr(`[otlp] export failed: ${err.message}\n`);
      }
    }
    if (_collectorEnabled) {
      try {
        const { exportTelemetryRecorder } =
          await import("../lib/observability/index.js");
        exportTelemetryRecorder(_otlpRecorder);
      } catch {
        // Telemetry is observational only and never changes the agent result.
      }
    }
  }

  // Exit-code taxonomy: max-turns → 3, cost cap → 4 (both still non-zero, so
  // "any failure" checks keep working; scripts can now tell exhaustion apart).
  return {
    exitCode: exitCodeForEndReason(endReason, isError),
    result: finalText,
    isError,
    ...(persistenceFailure ? { persistence: persistenceFailure } : {}),
  };
}

function buildResultEnvelope({
  subtype,
  isError,
  result,
  sessionId,
  toolCalls,
  usage,
  totalCostUsd,
  numTurns,
  durationMs,
  denials,
  compactionDegradations,
  persistence,
}) {
  const env = {
    type: "result",
    subtype,
    is_error: isError,
    result,
    session_id: sessionId,
    num_turns: numTurns,
    duration_ms: durationMs,
    tool_calls: toolCalls,
    usage,
    total_cost_usd: totalCostUsd,
  };
  // Only present when something was blocked — keeps the no-denial envelope
  // byte-identical to before (Claude-Code 2.1.193 denial reasons, json mode).
  if (Array.isArray(denials) && denials.length) env.denials = denials;
  if (Array.isArray(compactionDegradations) && compactionDegradations.length) {
    env.compaction_degradations = compactionDegradations;
  }
  if (persistence) env.persistence = persistence;
  return env;
}
