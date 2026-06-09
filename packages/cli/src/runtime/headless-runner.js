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
 *  - (default) / plan   → STRICT  + deny-confirmer  (plan also restricts tools)
 *  - acceptEdits        → TRUSTED + deny-confirmer  (HIGH-risk shell still denied)
 *  - bypassPermissions  → AUTOPILOT (everything allowed, no confirm)
 */

import { bootstrap } from "./bootstrap.js";
import {
  buildSystemPrompt,
  agentLoop as coreAgentLoop,
  formatToolArgs,
  killAllBackgroundShellTasks,
} from "./agent-core.js";
import {
  resolveAgentMcp,
  resolvePermissionPromptTool,
  makePermissionPromptConfirmer,
} from "./mcp-config.js";
import { IterationBudget } from "../lib/iteration-budget.js";
import {
  startSession as jsonlStartSession,
  appendUserMessage as jsonlAppendUserMessage,
  appendAssistantMessage as jsonlAppendAssistantMessage,
  appendTokenUsage as jsonlAppendTokenUsage,
  appendCompactEvent as jsonlAppendCompactEvent,
  rebuildMessages as jsonlRebuildMessages,
  sessionExists as jsonlSessionExists,
  getLastSessionId as jsonlGetLastSessionId,
} from "../harness/jsonl-session-store.js";
import { expandFileRefs } from "./file-ref-expander.js";
import { composeSystemPrompt } from "./system-prompt.js";
import { withQuietStdout } from "./quiet-stdout.js";

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
  "plan",
  "acceptEdits",
  "bypassPermissions",
]);

const VALID_OUTPUT_FORMATS = Object.freeze(["text", "json", "stream-json"]);

/**
 * Resolve a --permission-mode string into the session-policy tier + a
 * non-interactive confirmer + whether to clamp tools to the read-only set.
 *
 * @param {string} mode
 * @returns {{ sessionPolicy: string, confirmer: (ctx:any)=>Promise<boolean>, readOnly: boolean }}
 */
export function resolvePermissionMode(mode = "default") {
  const m = mode || "default";
  if (!VALID_PERMISSION_MODES.includes(m)) {
    throw new Error(
      `Invalid --permission-mode "${m}". Expected one of: ${VALID_PERMISSION_MODES.join(", ")}`,
    );
  }
  // Headless can't ask a human — deny when a confirm would be required.
  const denyConfirmer = async () => false;
  const allowConfirmer = async () => true;
  switch (m) {
    case "bypassPermissions":
      return {
        sessionPolicy: "autopilot",
        confirmer: allowConfirmer,
        readOnly: false,
      };
    case "acceptEdits":
      return {
        sessionPolicy: "trusted",
        confirmer: denyConfirmer,
        readOnly: false,
      };
    case "plan":
      return {
        sessionPolicy: "strict",
        confirmer: denyConfirmer,
        readOnly: true,
      };
    case "default":
    default:
      return {
        sessionPolicy: "strict",
        confirmer: denyConfirmer,
        readOnly: false,
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
 * @param {object} options { resume, continueSession, sessionId, persistSession }
 * @param {object} store   { getLastSessionId }  (injection seam)
 * @param {string} fallbackId  used when nothing is being resumed
 * @returns {{ sessionId:string, resumeId:string|null, persist:boolean, wantLatest:boolean }}
 */
export function resolveHeadlessSession(options = {}, store = {}, fallbackId) {
  const { resume, continueSession, sessionId, persistSession } = options;
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
  const persist = persistSession === true || resumeId != null || wantLatest;
  const id = resumeId || sessionId || fallbackId;
  return { sessionId: id, resumeId, persist, wantLatest };
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
 * @param {string} [options.cwd]
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
 * @returns {Promise<{ exitCode:number, result:string, isError:boolean }>}
 */
export async function runAgentHeadless(options = {}, deps = {}) {
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

  const model = options.model || "qwen2.5:7b";
  const provider = options.provider || "ollama";
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || null;
  const cwd = options.cwd || process.cwd();
  // Extra workspace roots (--add-dir). Resolved/validated by the caller; we
  // just normalize to a clean string[] here.
  const additionalDirectories = Array.isArray(options.additionalDirectories)
    ? options.additionalDirectories.filter(Boolean)
    : [];

  // .claude/settings.json permission rules (deny > ask > allow). A `deny` hard-
  // blocks, an `allow` pre-authorizes (so a safe op isn't fail-closed headless),
  // an `ask` falls closed (no human to confirm in headless). No file → null →
  // every existing risk-tier / shell-policy layer runs unchanged.
  let permissionRules = options.permissionRules || null;
  if (!permissionRules) {
    try {
      const { loadSettings } = await import("../lib/settings-loader.cjs");
      const loaded = loadSettings({ cwd, settingsFile: options.settingsFile });
      const total =
        loaded.rules.allow.length +
        loaded.rules.ask.length +
        loaded.rules.deny.length;
      permissionRules = total > 0 ? loaded.rules : null;
    } catch {
      permissionRules = null; // fail-open
    }
  }

  // .claude/settings.json `hooks` block — decision-capable PreToolUse/
  // PostToolUse hooks (see settings-hooks/hook-runner). null = no hooks.
  let settingsHooks = options.settingsHooks || null;
  if (!settingsHooks) {
    try {
      const { loadHooks } = await import("../lib/settings-hooks.cjs");
      const loaded = loadHooks({ cwd, settingsFile: options.settingsFile });
      settingsHooks =
        loaded.hooks && Object.keys(loaded.hooks).length > 0
          ? loaded.hooks
          : null;
    } catch {
      settingsHooks = null; // fail-open
    }
  }

  const runLoop = deps.agentLoop || coreAgentLoop;
  const doBootstrap = deps.bootstrap || bootstrap;
  const getApprovalGate =
    deps.getApprovalGate ||
    (async () => {
      const m = await import("../lib/session-core-singletons.js");
      return m.getApprovalGate();
    });
  // stdout carries the machine-consumable payload; stderr carries the human
  // trace so `cc agent -p ... > out.txt` keeps `out.txt` clean.
  const writeOut = deps.writeOut || ((s) => process.stdout.write(s));
  const writeErr = deps.writeErr || ((s) => process.stderr.write(s));
  // Session persistence seam (file-based JSONL; DB-free, like the rest of
  // headless). Defaults to the real store; tests inject fakes.
  const store = {
    sessionExists: deps.sessionExists || jsonlSessionExists,
    rebuildMessages: deps.rebuildMessages || jsonlRebuildMessages,
    startSession: deps.startSession || jsonlStartSession,
    appendUserMessage: deps.appendUserMessage || jsonlAppendUserMessage,
    appendAssistantMessage:
      deps.appendAssistantMessage || jsonlAppendAssistantMessage,
    appendTokenUsage: deps.appendTokenUsage || jsonlAppendTokenUsage,
    appendCompactEvent: deps.appendCompactEvent || jsonlAppendCompactEvent,
    getLastSessionId: deps.getLastSessionId || jsonlGetLastSessionId,
  };
  const isStream = outputFormat === "stream-json";
  const isJson = outputFormat === "json";
  const isText = outputFormat === "text";

  // ── Expand @file references in the prompt (Claude-Code parity) ─────────
  // `@path/to/file` tokens are augmented with the referenced file contents (or
  // a dir listing) so `cc agent -p "review @src/x.js"` works without a manual
  // cat-pipe. Opt out with `--no-file-refs` (options.expandFileRefs === false).
  let userContent = prompt;
  if (options.expandFileRefs !== false) {
    const doExpand = deps.expandFileRefs || expandFileRefs;
    const expanded = doExpand(prompt, { cwd });
    userContent = expanded.prompt;
    // Warnings (typo'd paths, unreadable files) go to stderr in every output
    // format so stdout stays a clean machine payload.
    for (const w of expanded.warnings) {
      writeErr(`  @ref: ${w}\n`);
    }
  }

  // ── Permission + tool resolution ──────────────────────────────────────
  const perm = resolvePermissionMode(options.permissionMode);
  const enabledToolNames = resolveEnabledTools({
    allowedTools: options.allowedTools,
    readOnly: perm.readOnly,
  });
  const disabledTools = options.disallowedTools || [];

  // ── Best-effort runtime bootstrap (DB optional, like startAgentRepl) ───
  let db = null;
  try {
    // Bootstrap logs db/config diagnostics via console.info (→ stdout); divert
    // to stderr so text/JSON/NDJSON stdout payloads stay clean.
    const ctx = await withQuietStdout(() => doBootstrap({ verbose: false }));
    db = ctx.db || null;
  } catch {
    // Continue without DB — static-prompt fallback.
  }

  // ── Resolve session continuity (--resume / --continue) ─────────────────
  const { sessionId, resumeId, persist } = resolveHeadlessSession(
    options,
    store,
    `headless-${Date.now()}-${process.pid}`,
  );
  if (options.continueSession === true && !resumeId && isText) {
    writeErr("No previous session to continue; starting a new one.\n");
  }

  // Load prior conversation when resuming an existing session. The fresh
  // system prompt always leads; we drop any persisted system turns so it is
  // never duplicated.
  let history = [];
  if (resumeId && store.sessionExists(resumeId)) {
    try {
      history = (store.rebuildMessages(resumeId) || []).filter(
        (m) => m && m.role !== "system",
      );
    } catch {
      history = [];
    }
  }

  // ── Wire the persistent ApprovalGate with our non-interactive confirmer
  // and force the session-policy tier dictated by --permission-mode. ──────
  let approvalGate = null;
  try {
    approvalGate = await getApprovalGate();
    if (approvalGate) {
      if (typeof approvalGate.setSessionPolicy === "function") {
        approvalGate.setSessionPolicy(sessionId, perm.sessionPolicy);
      }
      if (typeof approvalGate.setConfirmer === "function") {
        approvalGate.setConfirmer(perm.confirmer);
      }
    }
  } catch {
    approvalGate = null;
  }

  const budget = Number.isFinite(options.maxTurns)
    ? new IterationBudget({ limit: Math.max(1, Math.floor(options.maxTurns)) })
    : new IterationBudget();

  // Effective system prompt: built-in base, optionally replaced by
  // --system-prompt and/or extended by --append-system-prompt.
  const systemContent = composeSystemPrompt(
    buildSystemPrompt(cwd, { additionalDirectories }),
    {
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
    },
  );

  // settings.json UserPromptSubmit hooks. block → abort the run; context → inject.
  if (settingsHooks) {
    try {
      const { runUserPromptSubmitHooks } = await import(
        "../lib/settings-hook-events.cjs"
      );
      const ups = runUserPromptSubmitHooks(settingsHooks, {
        prompt: userContent,
        cwd,
        sessionId,
      });
      if (ups.blocked) {
        writeErr(
          `[hook] prompt blocked${ups.reason ? ": " + ups.reason : ""}\n`,
        );
        return {
          exitCode: 2,
          result: ups.reason || "blocked by UserPromptSubmit hook",
          isError: true,
        };
      }
      if (ups.additionalContext) {
        userContent += `\n\n[hook context]\n${ups.additionalContext}`;
      }
    } catch (_err) {
      // settings hook dispatch is best-effort
    }
  }

  // settings.json SessionStart hooks → inject session context (observe-only).
  let sessionStartContext = null;
  if (settingsHooks) {
    try {
      const { runSessionStartHooks } = await import(
        "../lib/settings-hook-events.cjs"
      );
      sessionStartContext = runSessionStartHooks(settingsHooks, {
        source: resumeId ? "resume" : "startup",
        cwd,
        sessionId,
      }).additionalContext;
    } catch (_err) {
      sessionStartContext = null;
    }
  }

  const messages = [
    { role: "system", content: systemContent },
    ...(sessionStartContext
      ? [{ role: "system", content: sessionStartContext }]
      : []),
    ...history,
    { role: "user", content: userContent },
  ];

  // Persist the user turn up front (best-effort) so a session is recoverable
  // even if the run crashes mid-loop. startSession is append-safe: only seed
  // the header when the file does not yet exist.
  if (persist) {
    try {
      if (!store.sessionExists(sessionId)) {
        store.startSession(sessionId, {
          title: prompt.slice(0, 60),
          provider,
          model,
        });
      }
      // Persist the expanded content so a resumed session faithfully replays
      // what the model actually saw (the file snapshot, not just the @token).
      store.appendUserMessage(sessionId, userContent);
    } catch {
      // Persistence is best-effort — never fail the run over it.
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
  {
    const doResolve = deps.resolveAgentMcp || resolveAgentMcp;
    try {
      mcp = await doResolve(
        {
          mcpConfigPath: options.mcpConfig || null,
          db: db?.getDatabase?.() || null,
          includeRegistered: options.useRegisteredMcp !== false,
        },
        {
          writeErr,
          loadMcpConfig: deps.loadMcpConfig,
          loadRegisteredMcp: deps.loadRegisteredMcp,
        },
      );
      if (mcp && isText) {
        for (const c of mcp.connected) {
          writeErr(`  mcp: ${c.server} (${c.tools} tools)\n`);
        }
      }
    } catch (err) {
      writeErr(`Error: ${err.message}\n`);
      return { exitCode: 1, result: err.message, isError: true };
    }
  }

  // --permission-prompt-tool: route every CONFIRM-tier approval to an MCP tool
  // (loaded via --mcp-config) instead of headless fail-closed. Overrides the
  // permission-mode confirmer on the gate for this session.
  if (options.permissionPromptTool) {
    let ppt;
    try {
      ppt = resolvePermissionPromptTool(mcp, options.permissionPromptTool);
    } catch (err) {
      writeErr(`Error: ${err.message}\n`);
      if (mcp?.mcpClient) await mcp.mcpClient.disconnectAll().catch(() => {});
      return { exitCode: 1, result: err.message, isError: true };
    }
    if (approvalGate && typeof approvalGate.setConfirmer === "function") {
      approvalGate.setConfirmer(
        makePermissionPromptConfirmer({
          mcpClient: mcp.mcpClient,
          server: ppt.server,
          tool: ppt.tool,
          writeErr,
          isText,
        }),
      );
    }
  }

  const loopOptions = {
    model,
    provider,
    baseUrl,
    apiKey,
    cwd,
    additionalDirectories,
    sessionId,
    autoCheckpoint: options.autoCheckpoint || false,
    checkpointSession: options.checkpointSession || sessionId,
    hookDb: db,
    approvalGate,
    permissionRules,
    settingsHooks,
    enabledToolNames,
    disabledTools,
    iterationBudget: budget,
    // --mcp-config wiring: tool defs for the LLM + dispatch map + live client.
    mcpClient: mcp?.mcpClient || null,
    extraToolDefinitions: mcp?.extraToolDefinitions || undefined,
    externalToolExecutors: mcp?.externalToolExecutors || undefined,
    externalToolDescriptors: mcp?.externalToolDescriptors || undefined,
    // chatFn passthrough lets tests drive the loop deterministically.
    chatFn: deps.chatFn || options.chatFn || undefined,
    signal: options.signal || undefined,
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

  const startedAt = deps.now ? deps.now() : Date.now();
  const toolCalls = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let finalText = "";
  let endReason = "complete";

  const emitStream = (obj) => {
    if (isStream) writeOut(JSON.stringify(obj) + "\n");
  };

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
    session_id: sessionId,
    model,
    provider,
    permission_mode: options.permissionMode || "default",
    tools: enabledToolNames,
    max_turns: budget.limit,
    resumed_from: resumeId,
    history_messages: history.length,
    additional_directories: additionalDirectories,
    goal_id: boundGoalId,
  });

  try {
    for await (const event of runLoop(messages, loopOptions)) {
      switch (event.type) {
        case "checkpoint": {
          if (isText)
            writeErr(`  ⎌ checkpoint ${event.id} (before ${event.tool})\n`);
          emitStream({ type: "checkpoint", id: event.id, tool: event.tool });
          break;
        }
        case "tool-executing": {
          const line = `  [${event.tool}] ${formatToolArgs(event.tool, event.args)}`;
          if (isText) writeErr(line + "\n");
          emitStream({
            type: "tool_use",
            tool: event.tool,
            args: event.args,
          });
          toolCalls.push({ tool: event.tool, args: event.args });
          break;
        }
        case "tool-result": {
          const err = event.error || event.result?.error || null;
          if (isText && err) writeErr(`  Error: ${err}\n`);
          emitStream({
            type: "tool_result",
            tool: event.tool,
            is_error: Boolean(err),
            error: err,
            result: event.result,
          });
          if (toolCalls.length > 0) {
            toolCalls[toolCalls.length - 1].is_error = Boolean(err);
          }
          break;
        }
        case "token-usage": {
          usage.input_tokens += event.usage?.input_tokens || 0;
          usage.output_tokens += event.usage?.output_tokens || 0;
          emitStream({ type: "token_usage", usage: event.usage });
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
          break;
        }
        case "run-ended": {
          if (event.reason) endReason = event.reason;
          break;
        }
        default:
          // slot-filling, run-started, etc. — surfaced only in stream mode.
          if (isStream && event.type) emitStream(event);
          break;
      }
    }
  } catch (err) {
    const message = err?.message || String(err);
    if (isStream) {
      emitStream({
        type: "result",
        subtype: "error",
        is_error: true,
        error: message,
      });
    } else if (isJson) {
      writeOut(
        JSON.stringify(
          buildResultEnvelope({
            subtype: "error",
            isError: true,
            result: message,
            sessionId,
            toolCalls,
            usage,
            numTurns: budget.consumed,
            durationMs: (deps.now ? deps.now() : Date.now()) - startedAt,
          }),
        ) + "\n",
      );
    } else {
      writeErr(`Error: ${message}\n`);
    }
    return { exitCode: 1, result: message, isError: true };
  } finally {
    // Tear down ad-hoc MCP servers (--mcp-config) before returning, whether the
    // loop completed or threw. Best-effort: a failed disconnect never masks the
    // run's own outcome.
    if (mcp?.mcpClient) {
      try {
        await mcp.mcpClient.disconnectAll();
      } catch {
        // ignore — disconnect is best-effort
      }
    }
    // Kill any background run_shell tasks this run spawned so a backgrounded
    // command (e.g. a dev server) doesn't outlive the headless invocation.
    try {
      killAllBackgroundShellTasks();
    } catch {
      // best-effort — never mask the run's own outcome
    }
  }

  // coreAgentLoop emits run-ended reason "budget-exhausted" when the iteration
  // cap is hit; treat that as the max-turns error surface.
  const exhausted =
    endReason === "budget-exhausted" || endReason === "max_turns";
  const isError = exhausted || endReason === "no-response";
  const subtype = exhausted ? "error_max_turns" : isError ? "error" : "success";
  const durationMs = (deps.now ? deps.now() : Date.now()) - startedAt;

  // Persist the assistant turn so a later --resume / --continue replays it.
  // The user turn was already recorded up front; only append on a clean run.
  if (persist && !isError) {
    try {
      if (finalText) store.appendAssistantMessage(sessionId, finalText);
      store.appendTokenUsage(sessionId, usage);
    } catch {
      // Persistence is best-effort — never fail the run over it.
    }
  }

  // Run-end goal self-assessment (cc goal Phase 2, opt-in via --goal-assess).
  // Spends one extra completion to judge whether the run advanced the bound
  // goal, then persists progress / key-result / drift updates. Best-effort: it
  // must never change the run's own outcome.
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
            const r = await chatWithTools(
              [{ role: "user", content: assessPrompt }],
              { model, provider, baseUrl, apiKey, enabledToolNames: [] },
            );
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
    } catch {
      /* assessment is best-effort — never affect the run outcome */
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
          numTurns: budget.consumed,
          durationMs,
        }),
      ) + "\n",
    );
  } else {
    // text: just the final answer on stdout.
    writeOut(finalText + (finalText.endsWith("\n") ? "" : "\n"));
  }

  return { exitCode: isError ? 1 : 0, result: finalText, isError };
}

function buildResultEnvelope({
  subtype,
  isError,
  result,
  sessionId,
  toolCalls,
  usage,
  numTurns,
  durationMs,
}) {
  return {
    type: "result",
    subtype,
    is_error: isError,
    result,
    session_id: sessionId,
    num_turns: numTurns,
    duration_ms: durationMs,
    tool_calls: toolCalls,
    usage,
  };
}
