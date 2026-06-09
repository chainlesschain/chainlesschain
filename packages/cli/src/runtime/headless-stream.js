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
import { IterationBudget } from "../lib/iteration-budget.js";
import {
  resolvePermissionMode,
  resolveEnabledTools,
} from "./headless-runner.js";
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

  let approvalGate = null;
  try {
    approvalGate = await getApprovalGate();
    if (approvalGate) {
      approvalGate.setSessionPolicy?.(sessionId, perm.sessionPolicy);
      approvalGate.setConfirmer?.(perm.confirmer);
    }
  } catch {
    approvalGate = null;
  }

  const systemContent = composeSystemPrompt(
    buildSystemPrompt(cwd, { additionalDirectories }),
    {
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
    },
  );
  const messages = [{ role: "system", content: systemContent }];

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

  const loopOptionsBase = {
    model,
    provider,
    baseUrl,
    apiKey,
    cwd,
    additionalDirectories,
    sessionId,
    hookDb: db,
    approvalGate,
    enabledToolNames,
    disabledTools,
    prepareCall: goalPrepareCallFn,
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

  for await (const line of readJsonLines(input)) {
    const parsed = parseInputEvent(line);
    if (parsed == null) continue; // blank line
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

    messages.push({ role: "user", content: userContent });
    turns += 1;

    let outcome;
    try {
      outcome = await runTurn(
        messages,
        { ...loopOptionsBase, iterationBudget: budget },
        { runLoop, emit },
      );
    } catch (err) {
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

    // Grow the conversation so the next turn has context.
    messages.push({ role: "assistant", content: outcome.finalText });

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
  }

  emit({ type: "system", subtype: "end", session_id: sessionId, turns });
  return { exitCode: sawError ? 1 : 0, turns };
}
