/**
 * Streaming-input headless runner — Claude-Code `--input-format stream-json`.
 *
 * Where `runAgentHeadless` runs ONE turn from a single prompt and exits, this
 * variant keeps a persistent conversation driven by NDJSON user events on
 * stdin: one JSON object per line, a turn per event, NDJSON results per turn,
 * until stdin closes. Pairs with `--output-format stream-json` for a full
 * program-to-agent duplex (SDK-style multi-turn).
 *
 * Input event shapes accepted (kept liberal for interop):
 *   {"type":"user","message":{"role":"user","content":"hi"}}
 *   {"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}
 *   {"type":"user","text":"hi"}   |  {"role":"user","content":"hi"}  |  {"prompt":"hi"}
 *
 * Reuses the exported permission/tool helpers + the core agent loop so it does
 * not duplicate (or fork) `runAgentHeadless`'s internals.
 */

import { bootstrap } from "./bootstrap.js";
import { buildSystemPrompt, agentLoop as coreAgentLoop } from "./agent-core.js";
import { composeSystemPrompt } from "./system-prompt.js";
import { expandFileRefs } from "./file-ref-expander.js";
import {
  resolveAgentMcp,
  resolvePermissionPromptTool,
  makePermissionPromptConfirmer,
} from "./mcp-config.js";
import { IterationBudget } from "../lib/iteration-budget.js";
import {
  resolvePermissionMode,
  resolveEnabledTools,
} from "./headless-runner.js";
import {
  startSession as jsonlStartSession,
  appendUserMessage as jsonlAppendUserMessage,
  appendAssistantMessage as jsonlAppendAssistantMessage,
  rebuildMessages as jsonlRebuildMessages,
  sessionExists as jsonlSessionExists,
} from "../harness/jsonl-session-store.js";
import { getPlanModeManager } from "../lib/plan-mode.js";

/**
 * Structured view of the global plan-mode state for `plan_update` events
 * (the chat panel renders its plan card from this). Pure read; never throws.
 */
export function planSnapshot(pm) {
  let items = [];
  let risk = null;
  try {
    const plan = pm.currentPlan;
    items = (plan?.items || []).map((i) => ({
      id: i.id,
      title: i.title,
      tool: i.tool,
      impact: i.estimatedImpact || "low",
      status: i.status,
    }));
    if (items.length > 0) {
      const r = pm.getRiskAssessment();
      if (r) risk = { level: r.level, totalScore: r.totalScore };
    }
  } catch {
    /* snapshot is best-effort */
  }
  return { active: pm.isActive(), state: pm.state || null, items, risk };
}
import { withQuietStdout } from "./quiet-stdout.js";

/**
 * Parse one NDJSON input line into { text } / { error } / null (blank → skip).
 */
export function parseInputEvent(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return null;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { error: `invalid JSON line: ${trimmed.slice(0, 80)}` };
  }
  // Plan-mode control events (chat-panel plan UI):
  //   {"type":"plan","action":"enter"|"approve"|"reject"}
  if (obj && typeof obj === "object" && obj.type === "plan") {
    const action = String(obj.action || "").toLowerCase();
    return action ? { plan: action } : null;
  }
  // Turn interrupt (panel Stop / Claude-Code Esc parity): aborts the
  // in-flight turn without ending the conversation. {"type":"interrupt"}
  if (obj && typeof obj === "object" && obj.type === "interrupt") {
    return { interrupt: true };
  }
  // Approval verdicts (panel Approve/Deny for --interactive-approvals):
  //   {"type":"approval","id":"appr-1","approve":true|false}
  if (obj && typeof obj === "object" && obj.type === "approval") {
    if (!obj.id) return null;
    return { approval: { id: String(obj.id), approve: obj.approve === true } };
  }
  const msg = obj && typeof obj === "object" ? obj.message || obj : {};
  let content = msg.content ?? obj.text ?? obj.prompt;
  if (Array.isArray(content)) {
    content = content
      .map((b) => (typeof b === "string" ? b : b?.text || ""))
      .join("");
  }
  if (typeof content !== "string" || !content.trim()) return null;
  return { text: content };
}

/**
 * Yield NDJSON lines from a byte/string stream (stdin). Splits on "\n" and
 * flushes any trailing partial line when the stream ends.
 */
export async function* readJsonLines(input) {
  let buf = "";
  for await (const chunk of input) {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 1);
    }
  }
  if (buf.trim()) yield buf;
}

/**
 * Run a single turn through the core agent loop, emitting NDJSON events.
 * Returns the turn outcome so the caller can grow history + the result line.
 */
async function runTurn(messages, loopOptions, { runLoop, emit }) {
  const usage = { input_tokens: 0, output_tokens: 0 };
  const toolCalls = [];
  let finalText = "";
  let endReason = "complete";

  for await (const event of runLoop(messages, loopOptions)) {
    switch (event.type) {
      case "tool-executing":
        toolCalls.push({ tool: event.tool, args: event.args });
        emit({ type: "tool_use", tool: event.tool, args: event.args });
        break;
      case "tool-result": {
        const err = event.error || event.result?.error || null;
        if (toolCalls.length > 0)
          toolCalls[toolCalls.length - 1].is_error = Boolean(err);
        emit({
          type: "tool_result",
          tool: event.tool,
          is_error: Boolean(err),
          error: err,
          result: event.result,
        });
        break;
      }
      case "token-usage":
        usage.input_tokens += event.usage?.input_tokens || 0;
        usage.output_tokens += event.usage?.output_tokens || 0;
        emit({ type: "token_usage", usage: event.usage });
        break;
      case "iteration-warning":
        emit({ type: "iteration_warning", message: event.message });
        break;
      case "iteration-budget-exhausted":
        endReason = "max_turns";
        emit({ type: "iteration_budget_exhausted", budget: event.budget });
        break;
      case "response-complete":
        finalText = event.content || "";
        break;
      case "run-ended":
        if (event.reason) endReason = event.reason;
        break;
      default:
        if (event.type) emit(event);
        break;
    }
  }
  return { finalText, endReason, usage, toolCalls };
}

/**
 * Drive a multi-turn headless conversation from NDJSON stdin events.
 *
 * @param {object} options  same shape as runAgentHeadless (minus single prompt)
 * @param {object} [deps]   { input, bootstrap, getApprovalGate, agentLoop,
 *                            writeOut, writeErr, expandFileRefs }
 * @returns {Promise<{exitCode:number, turns:number}>}
 */
export async function runAgentHeadlessStream(options = {}, deps = {}) {
  const model = options.model || "qwen2.5:7b";
  const provider = options.provider || "ollama";
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || null;
  const cwd = options.cwd || process.cwd();
  const additionalDirectories = Array.isArray(options.additionalDirectories)
    ? options.additionalDirectories.filter(Boolean)
    : [];

  // .claude/settings.json permission rules (deny > ask > allow); see
  // runAgentHeadless for the full semantics. null = no file → unchanged.
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

  // .claude/settings.json `hooks` block (decision-capable PreToolUse/PostToolUse).
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

  const input = deps.input || process.stdin;
  const runLoop = deps.agentLoop || coreAgentLoop;
  const doBootstrap = deps.bootstrap || bootstrap;
  const doExpand = deps.expandFileRefs || expandFileRefs;
  const writeOut = deps.writeOut || ((s) => process.stdout.write(s));
  const writeErr = deps.writeErr || ((s) => process.stderr.write(s));
  const emit = (obj) => writeOut(JSON.stringify(obj) + "\n");

  const getApprovalGate =
    deps.getApprovalGate ||
    (async () => {
      const m = await import("../lib/session-core-singletons.js");
      return m.getApprovalGate();
    });

  const perm = resolvePermissionMode(options.permissionMode);
  const enabledToolNames = resolveEnabledTools({
    allowedTools: options.allowedTools,
    readOnly: perm.readOnly,
  });
  const disabledTools = options.disallowedTools || [];

  let db = null;
  try {
    // Bootstrap logs db/config diagnostics via console.info (→ stdout); divert
    // to stderr so the NDJSON stream stays clean.
    const ctx = await withQuietStdout(() => doBootstrap({ verbose: false }));
    db = ctx.db || null;
  } catch {
    // DB optional — static-prompt fallback.
  }

  const sessionId =
    options.sessionId || `headless-stream-${Date.now()}-${process.pid}`;

  // Session persistence + resume (chat-panel "session resume" / --resume):
  // an EXPLICIT session id (--session / --resume) opts into JSONL persistence —
  // prior history is rebuilt into the conversation and every new turn is
  // appended, so a later run with the same id picks up where this one left
  // off. Anonymous runs (no id) stay persistence-free, exactly as before.
  const store = {
    sessionExists: deps.sessionExists || jsonlSessionExists,
    startSession: deps.startSession || jsonlStartSession,
    appendUserMessage: deps.appendUserMessage || jsonlAppendUserMessage,
    appendAssistantMessage:
      deps.appendAssistantMessage || jsonlAppendAssistantMessage,
    rebuildMessages: deps.rebuildMessages || jsonlRebuildMessages,
  };
  const persist = Boolean(options.sessionId);

  // ── Interactive approvals (--interactive-approvals; chat-panel UX) ────────
  // CONFIRM-tier decisions (risky shell via the ApprovalGate, settings/hook
  // `ask`) normally fail closed in headless. With this opt-in they become a
  // structured round-trip instead: emit `approval_request`, BLOCK the tool
  // until a {"type":"approval",id,approve} arrives on stdin (handled by the
  // concurrent pump below, so the wait never deadlocks), fail closed on
  // timeout (CC_APPROVAL_TIMEOUT_MS, default 120s) or stdin close. The
  // resolution is echoed as `approval_resolved` so UIs can settle their cards.
  const interactive = options.interactiveApprovals === true;
  const pendingApprovals = new Map();
  let approvalSeq = 0;
  const approvalTimeoutMs =
    Number(process.env.CC_APPROVAL_TIMEOUT_MS) > 0
      ? Number(process.env.CC_APPROVAL_TIMEOUT_MS)
      : 120000;
  const settleApproval = (id, approve, via) => {
    const p = pendingApprovals.get(id);
    if (!p) return;
    pendingApprovals.delete(id);
    clearTimeout(p.timer);
    emit({
      type: "approval_resolved",
      id,
      approved: approve === true,
      via,
      session_id: sessionId,
    });
    p.resolve(approve === true);
  };
  const interactiveConfirm = (ctx = {}) =>
    new Promise((resolve) => {
      const id = `appr-${++approvalSeq}`;
      const timer = setTimeout(
        () => settleApproval(id, false, "timeout"),
        approvalTimeoutMs,
      );
      timer.unref?.();
      pendingApprovals.set(id, { resolve, timer });
      emit({
        type: "approval_request",
        id,
        session_id: sessionId,
        tool: ctx.tool || ctx.toolName || null,
        command: ctx.command || ctx.args?.command || null,
        risk: ctx.riskLevel || ctx.risk || null,
        rule: ctx.rule || null,
        reason: ctx.reason || null,
      });
    });

  let approvalGate = null;
  try {
    approvalGate = await getApprovalGate();
    if (approvalGate) {
      approvalGate.setSessionPolicy?.(sessionId, perm.sessionPolicy);
      approvalGate.setConfirmer?.(
        interactive ? interactiveConfirm : perm.confirmer,
      );
    }
  } catch {
    approvalGate = null;
  }

  // --output-style (or settings.json `outputStyle`) persona, appended.
  let outputStyleBody = null;
  try {
    const { resolveOutputStyle } = await import("../lib/output-styles.js");
    const st = resolveOutputStyle(options.outputStyle, cwd);
    if (st && st.body) outputStyleBody = st.body;
  } catch {
    outputStyleBody = null;
  }
  const systemContent = composeSystemPrompt(
    buildSystemPrompt(cwd, { additionalDirectories }),
    {
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
      outputStyle: outputStyleBody,
    },
  );
  const messages = [{ role: "system", content: systemContent }];

  // settings.json SessionStart hooks → inject session context once (observe-only).
  if (settingsHooks) {
    try {
      const { runSessionStartHooks } =
        await import("../lib/settings-hook-events.cjs");
      const ctx = runSessionStartHooks(settingsHooks, {
        source: "startup",
        cwd,
        sessionId,
      }).additionalContext;
      if (ctx) messages.push({ role: "system", content: ctx });
    } catch (_err) {
      // best-effort
    }
  }

  // Resume: replay the persisted conversation (fresh system prompt always
  // leads; persisted system turns are dropped, mirroring runAgentHeadless).
  let resumedMessages = 0;
  if (persist) {
    try {
      if (store.sessionExists(sessionId)) {
        const history = (store.rebuildMessages(sessionId) || []).filter(
          (m) => m && m.role !== "system",
        );
        messages.push(...history);
        resumedMessages = history.length;
      } else {
        store.startSession(sessionId, {
          title: "stream session",
          provider,
          model,
        });
      }
    } catch {
      // persistence is best-effort — never fail the stream over it
    }
  }

  emit({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    model,
    provider,
    permission_mode: options.permissionMode || "default",
    tools: enabledToolNames,
    input_format: "stream-json",
    additional_directories: additionalDirectories,
    resumed_messages: resumedMessages,
  });

  // Goal binding (cc goal, Phase 1) — resolved once and injected on every turn.
  // `--goal <id>` binds explicitly; `--goal` with no value auto-resolves.
  let goalPrepareCallFn;
  if (options.goal !== undefined && options.goal !== false) {
    try {
      const explicitId = typeof options.goal === "string" ? options.goal : null;
      const { resolveActiveGoal } = await import("../lib/goal-store.js");
      const goal = (deps.resolveActiveGoal || resolveActiveGoal)({
        explicitId,
        sessionId,
      });
      if (goal) {
        const { goalPrepareCall } = await import("../lib/goal-context.js");
        goalPrepareCallFn = goalPrepareCall(goal);
      }
    } catch {
      /* goal binding is best-effort — proceed without it */
    }
  }

  // Combine the ad-hoc --mcp-config file with the registered (cc mcp add)
  // auto-connect servers into one client for the whole stream session, exposing
  // every tool to the LLM. A bad --mcp-config file fails up front; registered
  // connects are best-effort. --no-mcp disables the registered set.
  let mcp = null;
  {
    const doResolve = deps.resolveAgentMcp || resolveAgentMcp;
    try {
      mcp = await doResolve(
        {
          mcpConfigPath: options.mcpConfig || null,
          db: db?.getDatabase?.() || null,
          includeRegistered: options.useRegisteredMcp !== false,
          ide: options.ide,
          cwd: options.cwd || process.cwd(),
        },
        {
          writeErr,
          loadMcpConfig: deps.loadMcpConfig,
          loadRegisteredMcp: deps.loadRegisteredMcp,
          loadIdeMcp: deps.loadIdeMcp,
        },
      );
    } catch (err) {
      emit({
        type: "result",
        subtype: "error",
        is_error: true,
        error: err.message,
      });
      return { exitCode: 1, turns: 0 };
    }
  }

  // --permission-prompt-tool: defer CONFIRM-tier approvals to an MCP tool
  // (loaded via --mcp-config) instead of headless fail-closed.
  if (options.permissionPromptTool) {
    let ppt;
    try {
      ppt = resolvePermissionPromptTool(mcp, options.permissionPromptTool);
    } catch (err) {
      emit({
        type: "result",
        subtype: "error",
        is_error: true,
        error: err.message,
      });
      if (mcp?.mcpClient) await mcp.mcpClient.disconnectAll().catch(() => {});
      return { exitCode: 1, turns: 0 };
    }
    if (approvalGate && typeof approvalGate.setConfirmer === "function") {
      approvalGate.setConfirmer(
        makePermissionPromptConfirmer({
          mcpClient: mcp.mcpClient,
          server: ppt.server,
          tool: ppt.tool,
        }),
      );
    }
  }

  const loopOptionsBase = {
    model,
    provider,
    // Extended thinking (Anthropic; opt-in via --think/--ultrathink).
    // thinkingBudget (--thinking-budget) = legacy-model budget_tokens override.
    thinking: options.thinking || null,
    thinkingBudget: options.thinkingBudget || null,
    baseUrl,
    apiKey,
    cwd,
    additionalDirectories,
    sessionId,
    hookDb: db,
    approvalGate,
    permissionRules,
    settingsHooks,
    enabledToolNames,
    disabledTools,
    // --interactive-approvals: settings/hook `ask` (and, with an IDE bridge,
    // edit reviews via openDiff) route to the structured approval round-trip
    // instead of failing closed. Absent in CI/pipes → unchanged fail-closed.
    permissionConfirm: interactive ? interactiveConfirm : undefined,
    prepareCall: goalPrepareCallFn,
    // --mcp-config wiring (tool defs + dispatch map + live client).
    mcpClient: mcp?.mcpClient || null,
    extraToolDefinitions: mcp?.extraToolDefinitions || undefined,
    externalToolExecutors: mcp?.externalToolExecutors || undefined,
    externalToolDescriptors: mcp?.externalToolDescriptors || undefined,
    chatFn: deps.chatFn || options.chatFn || undefined,
    signal: options.signal || undefined,
    // --include-partial-messages: stream live assistant-text deltas as
    // `stream_event` lines. Output here is always NDJSON, so gating on the
    // flag alone suffices.
    onToken: options.includePartialMessages
      ? (text) =>
          emit({
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text },
            },
          })
      : undefined,
  };

  let turns = 0;
  let sawError = false;

  // ── Concurrent stdin pump (turn-interrupt support) ────────────────────────
  // Input is consumed AS IT ARRIVES — not between turns — so an
  // {"type":"interrupt"} can abort the IN-FLIGHT turn immediately (chat-panel
  // Stop / Claude-Code Esc parity) instead of waiting in line behind it.
  // Normal events queue for the serial turn loop below; interrupts act on the
  // live per-turn AbortController and are never queued.
  const queue = [];
  let wakeQueue = null;
  let inputDone = false;
  let currentAbort = null;
  (async () => {
    try {
      for await (const line of readJsonLines(input)) {
        const parsed = parseInputEvent(line);
        if (parsed == null) continue;
        if (parsed.interrupt) {
          currentAbort?.abort();
          continue;
        }
        if (parsed.approval) {
          // Approval verdicts settle a BLOCKED tool — never queued.
          settleApproval(
            parsed.approval.id,
            parsed.approval.approve,
            parsed.approval.approve ? "user-approve" : "user-deny",
          );
          continue;
        }
        queue.push(parsed);
        if (wakeQueue) wakeQueue();
      }
    } catch {
      /* input stream error → treat as EOF */
    }
    inputDone = true;
    // stdin closed while approvals were pending → fail closed so the blocked
    // turn can finish and the process can exit.
    for (const id of [...pendingApprovals.keys()]) {
      settleApproval(id, false, "stdin-closed");
    }
    if (wakeQueue) wakeQueue();
  })();
  const nextEvent = async () => {
    for (;;) {
      if (queue.length > 0) return queue.shift();
      if (inputDone) return null;
      await new Promise((r) => {
        wakeQueue = r;
      });
      wakeQueue = null;
    }
  };

  for (;;) {
    const parsed = await nextEvent();
    if (parsed == null) break; // stdin closed
    if (parsed.error) {
      emit({
        type: "result",
        subtype: "error",
        is_error: true,
        error: parsed.error,
      });
      sawError = true;
      continue;
    }

    // Plan-mode control events (chat-panel plan UI). Mirrors the REPL's
    // /plan verbs: enter blocks write tools (blocked calls become plan items),
    // approve unlocks them and IMMEDIATELY runs a continuation turn, reject
    // exits plan mode. Every control answers with a `plan_update` event.
    if (parsed.plan) {
      const pm = getPlanModeManager();
      if (parsed.plan === "enter") {
        if (!pm.isActive()) {
          pm.enterPlanMode({ title: "Agent Plan" });
          messages.push({
            role: "system",
            content:
              "[PLAN MODE ACTIVE] You are now in plan mode. You can read " +
              "files, search, and analyze — but write/execute tools are " +
              "blocked. Any blocked tool calls will be recorded as plan " +
              "items. Analyze the task thoroughly, then the user will " +
              "approve your plan.",
          });
        }
        emit({
          type: "plan_update",
          ...planSnapshot(pm),
          session_id: sessionId,
        });
        continue;
      }
      if (parsed.plan === "reject") {
        if (pm.isActive()) pm.rejectPlan("User rejected");
        emit({
          type: "plan_update",
          ...planSnapshot(pm),
          session_id: sessionId,
        });
        continue;
      }
      if (parsed.plan === "approve") {
        if (!pm.isActive() || !(pm.currentPlan?.items?.length > 0)) {
          emit({
            type: "plan_update",
            ...planSnapshot(pm),
            session_id: sessionId,
            note: "nothing to approve",
          });
          continue;
        }
        pm.approvePlan();
        messages.push({
          role: "system",
          content: `[PLAN APPROVED] The user has approved your plan with ${pm.currentPlan.items.length} items. You can now use all tools including write_file, edit_file, run_shell, and run_skill. Execute the plan items in order.`,
        });
        emit({
          type: "plan_update",
          ...planSnapshot(pm),
          session_id: sessionId,
        });
        // Fall through into the normal turn machinery with a continuation
        // prompt — the agent starts executing without an extra user message.
        parsed.text = "Proceed with the approved plan.";
      } else if (!parsed.text) {
        continue; // unknown plan action — ignored
      }
    }

    // Per-turn iteration budget so one turn can't starve the rest.
    const budget = Number.isFinite(options.maxTurns)
      ? new IterationBudget({
          limit: Math.max(1, Math.floor(options.maxTurns)),
        })
      : new IterationBudget();

    // @file expansion per user event (parity with single-turn headless).
    let userContent = parsed.text;
    if (options.expandFileRefs !== false) {
      const expanded = doExpand(parsed.text, { cwd });
      userContent = expanded.prompt;
      for (const w of expanded.warnings) writeErr(`  @ref: ${w}\n`);
    }

    // settings.json UserPromptSubmit hooks. block → skip this turn; context → inject.
    if (settingsHooks) {
      try {
        const { runUserPromptSubmitHooks } =
          await import("../lib/settings-hook-events.cjs");
        const ups = runUserPromptSubmitHooks(settingsHooks, {
          prompt: userContent,
          cwd,
          sessionId,
        });
        if (ups.blocked) {
          emit({
            type: "result",
            subtype: "blocked",
            is_error: true,
            result: ups.reason || "blocked by UserPromptSubmit hook",
            session_id: sessionId,
          });
          continue;
        }
        if (ups.additionalContext) {
          userContent += `\n\n[hook context]\n${ups.additionalContext}`;
        }
      } catch (_err) {
        // settings hook dispatch is best-effort
      }
    }

    // IDE live context (Claude-Code parity): re-shared on every turn while an
    // IDE bridge is connected — the user's selection moves between prompts.
    // Best-effort; CC_IDE_CONTEXT=0 disables.
    try {
      const { buildIdePromptContext } = await import("../lib/ide-context.js");
      const ideCtx = await (
        deps.buildIdePromptContext || buildIdePromptContext
      )(mcp);
      if (ideCtx) userContent += `\n\n${ideCtx}`;
    } catch {
      // optional polish — never fail the turn over it
    }

    messages.push({ role: "user", content: userContent });
    if (persist) {
      try {
        store.appendUserMessage(sessionId, userContent);
      } catch {
        /* best-effort */
      }
    }
    turns += 1;

    // Per-turn abort scope: an {"type":"interrupt"} from the pump above
    // aborts THIS turn (LLM fetch included — the signal reaches chatWithTools)
    // while the conversation/process stays alive for the next message.
    currentAbort = new AbortController();
    const turnSignal = options.signal
      ? AbortSignal.any([options.signal, currentAbort.signal])
      : currentAbort.signal;

    let outcome;
    try {
      outcome = await runTurn(
        messages,
        { ...loopOptionsBase, iterationBudget: budget, signal: turnSignal },
        { runLoop, emit },
      );
    } catch (err) {
      currentAbort = null;
      const isAbort =
        err?.name === "AbortError" || /abort/i.test(err?.message || "");
      if (isAbort && !options.signal?.aborted) {
        // User-initiated turn interrupt — not an error; no assistant message
        // is recorded (the dangling user turn is fine for the next exchange).
        emit({
          type: "result",
          subtype: "interrupted",
          is_error: false,
          interrupted: true,
          session_id: sessionId,
          turn: turns,
        });
        continue;
      }
      if (isAbort) break; // outer options.signal — caller is shutting down
      emit({
        type: "result",
        subtype: "error",
        is_error: true,
        error: err?.message || String(err),
        turn: turns,
      });
      sawError = true;
      continue;
    }
    currentAbort = null;

    // Grow the conversation so the next turn has context.
    messages.push({ role: "assistant", content: outcome.finalText });
    if (persist) {
      try {
        store.appendAssistantMessage(sessionId, outcome.finalText);
      } catch {
        /* best-effort */
      }
    }

    const exhausted =
      outcome.endReason === "budget-exhausted" ||
      outcome.endReason === "max_turns";
    const isError = exhausted || outcome.endReason === "no-response";
    if (isError) sawError = true;

    emit({
      type: "result",
      subtype: exhausted ? "error_max_turns" : isError ? "error" : "success",
      is_error: isError,
      result: outcome.finalText,
      session_id: sessionId,
      turn: turns,
      usage: outcome.usage,
    });

    // While planning, blocked tool calls grew the plan during this turn —
    // push the fresh snapshot so the panel's plan card stays live.
    {
      const pm = getPlanModeManager();
      if (pm.isActive()) {
        emit({
          type: "plan_update",
          ...planSnapshot(pm),
          session_id: sessionId,
        });
      }
    }
  }

  // Tear down ad-hoc MCP servers (--mcp-config) when stdin closes.
  if (mcp?.mcpClient) {
    try {
      await mcp.mcpClient.disconnectAll();
    } catch {
      // ignore — disconnect is best-effort
    }
  }

  // settings.json SessionEnd hooks (observe-only) when stdin closes.
  if (settingsHooks) {
    try {
      const { runObserveHooks } =
        await import("../lib/settings-hook-events.cjs");
      runObserveHooks(
        settingsHooks,
        "SessionEnd",
        { reason: "stdin_closed", cwd, session_id: sessionId },
        { cwd },
      );
    } catch {
      // observe-only
    }
  }

  emit({ type: "system", subtype: "end", session_id: sessionId, turns });
  return { exitCode: sawError ? 1 : 0, turns };
}
