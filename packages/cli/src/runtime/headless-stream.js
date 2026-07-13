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

import { randomUUID } from "node:crypto";
import {
  approvalBindingDigest,
  verifyApprovalBinding,
} from "../lib/agent-authority.js";
import { bootstrap } from "./bootstrap.js";
import { buildSystemPrompt, agentLoop as coreAgentLoop } from "./agent-core.js";
import { composeSystemPrompt } from "./system-prompt.js";
import { collapseConsecutiveMessagesInPlace } from "./message-roles.js";
import { sanitizeToolPairs } from "../harness/prompt-compressor.js";
import { expandFileRefsAsync } from "./file-ref-expander.js";
// Per-turn helpers resolved at module load (not re-`await import`ed inside the
// turn loop). image-input + ide-context are pure local modules; pulling them up
// here — the same pattern as expandFileRefsAsync above — drops a per-turn ESM
// cache lookup + microtask on a long-lived stream session (the IDE chat panel).
import {
  detectImagePaths,
  resolveImages,
  buildUserContent,
  resolveVisionLlm,
} from "../lib/image-input.js";
import {
  buildIdePromptContext,
  expandIdeMentions,
} from "../lib/ide-context.js";
import { detectVersionSkew, versionSkewMessage } from "../lib/version-skew.js";
import {
  resolveAgentMcp,
  resolvePermissionPromptTool,
  makePermissionPromptConfirmer,
} from "./mcp-config.js";
import { maybeApplyToolSearch } from "./mcp-tool-search.js";
import {
  STREAM_PROTOCOL_VERSION,
  computePolicyDigest,
  computeToolsHash,
  buildLoadedSources,
  buildAgentCapabilities,
} from "../lib/headless-manifest.js";
import {
  negotiateProtocol,
  buildServerOffer,
  applyNegotiationToGate,
} from "../lib/capability-negotiation.js";
import { IterationBudget } from "../lib/iteration-budget.js";
import { CostBudget } from "../lib/cost-budget.js";
import {
  resolvePermissionMode,
  resolveEnabledTools,
  parseToolList,
  installPipeSafety,
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
 * Resolve the streaming-delta coalesce window (ms). Adjacent partial-message
 * text/thinking deltas are batched into a single `stream_event` line over this
 * window, cutting per-token JSON.stringify + write + downstream parse/postMessage
 * overhead (Claude-Code 2.1.191: "Reduced CPU usage during streaming responses by
 * coalescing text updates"). `0` (or a negative / non-numeric value) disables
 * batching, restoring the exact per-token emit behavior. Precedence:
 * explicit `options.streamCoalesceMs` > `CC_STREAM_COALESCE_MS` env > default 50.
 */
export function resolveStreamCoalesceMs(options = {}, env = {}) {
  const pick =
    options.streamCoalesceMs !== undefined
      ? options.streamCoalesceMs
      : env.CC_STREAM_COALESCE_MS;
  if (pick === undefined || pick === null || pick === "") return 50;
  const n = Number(pick);
  if (!Number.isFinite(n) || n < 0) return 50;
  return n;
}

/** Basic wire-safe trace-id sanitizer: keep only id-friendly chars, cap length
 *  (so an injected id can't smuggle whitespace/newlines into NDJSON or blow up
 *  a log line). Non-string / empty after trimming → falsy so a fresh one mints. */
function sanitizeTraceId(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[^A-Za-z0-9._:-]/g, "");
  return cleaned ? cleaned.slice(0, 128) : null;
}

/**
 * Resolve the run's cross-event trace id (additive protocol-v1, §1.2.1).
 * Precedence: explicit `options.traceId` > `CC_TRACE_ID` env > a freshly
 * minted per-process id. Callers may inject `deps.genTraceId` for
 * deterministic tests. The result is sanitized so an externally supplied id
 * stays a safe single NDJSON token.
 */
export function resolveTraceId(options = {}, env = {}, deps = {}) {
  const supplied =
    sanitizeTraceId(options.traceId) || sanitizeTraceId(env.CC_TRACE_ID);
  if (supplied) return supplied;
  const gen = deps.genTraceId || (() => `tr-${randomUUID()}`);
  return gen();
}

/**
 * Coalescer for the NDJSON output stream. Every line still flows through `emit`,
 * but consecutive partial-message text/thinking deltas are buffered and flushed
 * as one batched `stream_event` line: on a short timer (`coalesceMs`), whenever a
 * delta of the OTHER kind or any non-delta line is emitted (so ordering is always
 * preserved — a batched text run is flushed before the tool_use/result that
 * follows it), and at stream end (the terminal line routes through `emit`). With
 * `coalesceMs <= 0` deltas pass straight through, matching the legacy behavior.
 *
 * The flush timer is `unref()`d so it never holds the process open. Pure aside
 * from the injected `writeOut`/timer seams, so it unit-tests deterministically.
 *
 * Every emitted NDJSON line is stamped with a monotonic 1-based `seq`
 * (additive protocol-v1 field, agent-sdk docs/PROTOCOL.md §1.2.1) — the
 * coalescer is the single output choke point, so numbering here covers every
 * line including batched delta runs (one seq per LINE, not per token).
 * `stampSeq:false` restores the unstamped legacy output.
 *
 * When a `traceId` is provided, every line is ALSO stamped with `trace_id` —
 * a run-scoped cross-event correlation id (additive protocol-v1, §1.2.1). It
 * is opt-in (default: absent, legacy shape) so the IDE bridge can thread its
 * own id end-to-end (CC_TRACE_ID / --trace-id) while unstamped callers stay
 * byte-identical.
 */
export function createStreamCoalescer({
  writeOut,
  coalesceMs = 50,
  setTimer,
  clearTimer,
  stampSeq = true,
  traceId = null,
  fieldGate = null,
} = {}) {
  let seq = 0;
  // `fieldGate` (if provided) is read LIVE per line so a capability
  // negotiation arriving mid-stream (client `hello`) can suppress an additive
  // field the client said it can't parse. Absent / undefined key = stamp (so
  // the default path is byte-for-byte unchanged); only an explicit `false`
  // suppresses. See lib/capability-negotiation.js applyNegotiationToGate.
  const gateOn = (field) => !fieldGate || fieldGate[field] !== false;
  const rawEmit = (obj) => {
    let line = obj;
    if (traceId && gateOn("trace_id")) line = { ...line, trace_id: traceId };
    if (stampSeq && gateOn("seq")) line = { ...line, seq: ++seq };
    writeOut(JSON.stringify(line) + "\n");
  };
  const startTimer =
    setTimer ||
    ((fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    });
  const stopTimer = clearTimer || ((t) => clearTimeout(t));

  let pending = null; // { kind: "text" | "thinking", text: string }
  let timer = null;

  const buildLine = (kind, text) => ({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta:
        kind === "thinking"
          ? { type: "thinking_delta", thinking: text }
          : { type: "text_delta", text },
    },
  });

  const flush = () => {
    if (timer != null) {
      stopTimer(timer);
      timer = null;
    }
    if (!pending) return;
    const p = pending;
    pending = null;
    rawEmit(buildLine(p.kind, p.text));
  };

  const delta = (kind, text) => {
    if (!(coalesceMs > 0)) {
      rawEmit(buildLine(kind, text));
      return;
    }
    if (pending && pending.kind !== kind) flush();
    if (!pending) pending = { kind, text: "" };
    pending.text += text;
    if (timer == null) timer = startTimer(flush, coalesceMs);
  };

  return {
    // Any non-delta line flushes pending deltas first to preserve ordering.
    emit: (obj) => {
      flush();
      rawEmit(obj);
    },
    emitTextDelta: (text) => delta("text", text),
    emitThinkingDelta: (text) => delta("thinking", text),
    flush,
  };
}

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

const MAX_PLAN_REVIEW_SNAPSHOT_CHARS = 24000;

function planReviewFromInput(obj) {
  const review =
    obj && obj.review && typeof obj.review === "object" ? obj.review : null;
  const snapshot =
    typeof obj?.snapshot === "string"
      ? obj.snapshot
      : typeof review?.snapshot === "string"
        ? review.snapshot
        : "";
  if (!snapshot.trim()) return null;
  const text =
    snapshot.length > MAX_PLAN_REVIEW_SNAPSHOT_CHARS
      ? snapshot.slice(0, MAX_PLAN_REVIEW_SNAPSHOT_CHARS) +
        `\n\n[review snapshot truncated: ${snapshot.length - MAX_PLAN_REVIEW_SNAPSHOT_CHARS} chars omitted]`
      : snapshot;
  return {
    action: String(review?.action || obj.action || "").toLowerCase(),
    reviewedAt:
      typeof review?.reviewedAt === "string" ? review.reviewedAt : null,
    conversationId:
      typeof review?.conversationId === "string" ? review.conversationId : null,
    snapshot: text,
  };
}

function planReviewSystemMessage(review) {
  if (!review?.snapshot) return null;
  const meta = [
    review.action ? `action=${review.action}` : null,
    review.reviewedAt ? `reviewedAt=${review.reviewedAt}` : null,
    review.conversationId ? `conversationId=${review.conversationId}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    "[PLAN REVIEW SNAPSHOT]" + (meta ? ` ${meta}` : "") + "\n" + review.snapshot
  );
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
  // Capability handshake (agent-sdk docs/PROTOCOL.md §1.3): an optional first
  // line by which the client announces the protocol range + wire features it
  // understands, so the CLI can negotiate a common level and step down on
  // disagreement. {"type":"hello","protocol_version":2,"features":[...]}
  if (obj && typeof obj === "object" && obj.type === "hello") {
    const offer = {};
    if (obj.protocol_version !== undefined)
      offer.protocolVersion = obj.protocol_version;
    if (obj.min_protocol_version !== undefined)
      offer.minProtocolVersion = obj.min_protocol_version;
    if (obj.features !== undefined) offer.features = obj.features;
    return { hello: offer };
  }
  // Plan-mode control events (chat-panel plan UI):
  //   {"type":"plan","action":"enter"|"approve"|"reject"}
  if (obj && typeof obj === "object" && obj.type === "plan") {
    const action = String(obj.action || "").toLowerCase();
    if (!action) return null;
    const planReview = planReviewFromInput(obj);
    return planReview ? { plan: action, planReview } : { plan: action };
  }
  // Turn interrupt (panel Stop / Claude-Code Esc parity): aborts the
  // in-flight turn without ending the conversation. {"type":"interrupt"}
  if (obj && typeof obj === "object" && obj.type === "interrupt") {
    return { interrupt: true };
  }
  // Manual compaction (panel `/compact`, Claude-Code IDE parity): trim the
  // live conversation history in place between turns. {"type":"compact"}
  if (obj && typeof obj === "object" && obj.type === "compact") {
    return { compact: true };
  }
  // Approval verdicts (panel Approve/Deny for --interactive-approvals):
  //   {"type":"approval","id":"appr-1","approve":true|false}
  if (obj && typeof obj === "object" && obj.type === "approval") {
    if (!obj.id) return null;
    return {
      approval: {
        id: String(obj.id),
        approve: obj.approve === true,
        // Optional approval binding (authority §"权限来源与跨 Agent 授权边界"):
        // when present it must match the digest the matching approval_request
        // advertised, so a stale/mis-routed/param-substituted verdict can't
        // green-light a different tool call. Absent → legacy behavior.
        binding: typeof obj.binding === "string" ? obj.binding : null,
      },
    };
  }
  // Answer to an ask_user_question (panel QuickPick for interactive questions):
  //   {"type":"answer","id":"q-1","answer":<string|string[]|null>}
  // A null/absent answer cancels (handler → user_timeout, model proceeds).
  if (obj && typeof obj === "object" && obj.type === "answer") {
    if (!obj.id) return null;
    return {
      answer: {
        id: String(obj.id),
        value: obj.answer === undefined ? null : obj.answer,
      },
    };
  }
  // PDH self-learning feedback (design module 101 §3.5.13). The personal-data
  // chat's 纠正卡 sends {"type":"feedback","turn_id":…,"kind":"positive"|
  // "negative"|"correction","comment":…} after a reply. A missing kind → skip.
  if (obj && typeof obj === "object" && obj.type === "feedback") {
    const kind = String(obj.kind || "").toLowerCase();
    if (!kind) return null;
    return {
      feedback: {
        turnId: obj.turn_id != null ? String(obj.turn_id) : null,
        kind,
        comment: typeof obj.comment === "string" ? obj.comment : null,
      },
    };
  }
  // PDH guided-collection resume (design module 101 §3.5.15). When a PDH tool
  // returns assist_required (e.g. "log into the app first") the chat's 引导卡
  // sends {"type":"resume","token":…,"action":"completed"|"skip"} once the user
  // finishes or skips the in-app step. A missing action → skip.
  if (obj && typeof obj === "object" && obj.type === "resume") {
    const action = String(obj.action || "").toLowerCase();
    if (!action) return null;
    return {
      resume: {
        token: obj.token != null ? String(obj.token) : null,
        action,
      },
    };
  }
  const msg = obj && typeof obj === "object" ? obj.message || obj : {};
  let content = msg.content ?? obj.text ?? obj.prompt;
  if (Array.isArray(content)) {
    content = content
      .map((b) => (typeof b === "string" ? b : b?.text || ""))
      .join("");
  }
  // Vision input (chat-panel image paste): {"type":"user","text":…,
  // "images":["/abs/file.png", …]} — file paths, resolved at turn build via
  // the same image-input pipeline as `cc agent --image`.
  const rawImages =
    obj && typeof obj === "object" ? obj.images || msg.images : null;
  let images = Array.isArray(rawImages)
    ? rawImages.filter((p) => typeof p === "string" && p.trim())
    : [];
  // Claude-Code-style: auto-attach local image-file paths the user typed into
  // the message (so "describe ./shot.png" reads the image, like Claude Code).
  // Opt out with CC_AUTO_IMAGE=0. Explicit `images` (paste) still win.
  if (
    typeof content === "string" &&
    content.trim() &&
    process.env.CC_AUTO_IMAGE !== "0"
  ) {
    const detected = detectImagePaths(content);
    if (detected.images.length) {
      images = [...images, ...detected.images];
      content = detected.text;
    }
  }
  images = [...new Set(images)].slice(0, 8);
  // §3.5.10 接线6: optional per-turn LLM override (PDH privacy-tier switch) —
  // {"type":"user","text":…,"llm":{"provider","model","baseUrl"?,"apiKey"?}}.
  // Switches THIS turn's model (e.g. cloud → your own PC Ollama) without
  // restarting the session. Reuses the same per-turn loopOptions seam as vision.
  const llm = sanitizeLlmHint(
    obj && typeof obj === "object" ? obj.llm || msg.llm : null,
  );
  if (typeof content !== "string" || !content.trim()) {
    // An image-only turn is valid — give the model something to act on.
    if (images.length) {
      const r = { text: "Please look at the attached image(s).", images };
      if (llm) r.llm = llm;
      return r;
    }
    return null;
  }
  const result = images.length ? { text: content, images } : { text: content };
  if (llm) result.llm = llm;
  return result;
}

/**
 * §3.5.10 接线6: sanitize a per-turn LLM override hint. Requires at least a
 * provider or model (string); baseUrl/apiKey optional. Returns null when absent
 * or malformed (the turn then uses the session default).
 */
export function sanitizeLlmHint(raw) {
  if (!raw || typeof raw !== "object") return null;
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const provider = str(raw.provider);
  const model = str(raw.model);
  if (!provider && !model) return null;
  const hint = {};
  if (provider) hint.provider = provider;
  if (model) hint.model = model;
  const baseUrl = str(raw.baseUrl);
  if (baseUrl) hint.baseUrl = baseUrl;
  const apiKey = str(raw.apiKey);
  if (apiKey) hint.apiKey = apiKey;
  return hint;
}

/**
 * Yield NDJSON lines from a byte/string stream (stdin). Splits on "\n" and
 * flushes any trailing partial line when the stream ends.
 *
 * A single line with no terminating "\n" must never accumulate without bound:
 * a stuck / garbage producer (or a runaway multi-MB inline payload) that never
 * emits a newline would otherwise grow `buf` unbounded and OOM this long-lived
 * stream process. When a line exceeds the cap, a short head is yielded (so the
 * caller surfaces it as an invalid-JSON error rather than dropping it silently)
 * and the rest of that monster line is discarded until its newline — the stream
 * resyncs cleanly to the next well-formed line. Cap precedence:
 * `opts.maxLineLength` > `CC_MAX_INPUT_LINE_BYTES` env > 16 MB default.
 */
export async function* readJsonLines(input, opts = {}) {
  const envCap = Number(process.env.CC_MAX_INPUT_LINE_BYTES);
  const maxLineLength =
    Number.isFinite(opts.maxLineLength) && opts.maxLineLength > 0
      ? opts.maxLineLength
      : Number.isFinite(envCap) && envCap > 0
        ? envCap
        : 16 * 1024 * 1024;
  let buf = "";
  let overflow = false; // discarding the tail of an over-long line until its \n
  // Reuse ONE streaming decoder across chunks so a multi-byte UTF-8 character
  // (e.g. a 3-byte Chinese char) split across two Buffer chunks is reassembled
  // rather than corrupted. process.stdin yields Buffers with no setEncoding, so
  // a per-chunk `chunk.toString("utf-8")` would turn a split character into
  // U+FFFD replacement chars.
  const decoder = new TextDecoder();
  for await (const chunk of input) {
    buf +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    // Still skipping past an over-long line: drop everything up to (and
    // including) the next newline, then resume normal line parsing. While no
    // newline has arrived, keep `buf` empty so we don't re-grow it.
    if (overflow) {
      const nl = buf.indexOf("\n");
      if (nl < 0) {
        buf = "";
        continue;
      }
      buf = buf.slice(nl + 1);
      overflow = false;
    }
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 1);
    }
    // No newline in the remaining buffer and it has blown past the cap — this is
    // a pathological unterminated line. Yield a short head (an invalid-JSON
    // error for the caller) and discard the rest until the next newline.
    if (buf.length > maxLineLength) {
      yield buf.slice(0, 200);
      buf = "";
      overflow = true;
    }
  }
  buf += decoder.decode(); // flush any bytes held from a final partial char
  if (!overflow && buf.trim()) yield buf;
}

/**
 * Run a single turn through the core agent loop, emitting NDJSON events.
 * Returns the turn outcome so the caller can grow history + the result line.
 */
async function runTurn(
  messages,
  loopOptions,
  { runLoop, emit, costBudget, nextToolUseId },
) {
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  const toolCalls = [];
  let finalText = "";
  let endReason = "complete";
  let stopForCost = false;

  // Collapse consecutive same-role turns before the model call ONLY when the
  // caller flags a resume-degenerate transcript (`mergeRoles`): a resumed
  // session whose previous run produced NO assistant response leaves a trailing
  // bare `user` turn, so splicing the first live prompt after it sends two
  // adjacent `user` messages — which Anthropic/Bedrock reject as "roles must
  // alternate" (Claude Code 2.1.187 parity). It is GATED rather than applied
  // every turn because the live turn loop legitimately produces consecutive
  // `user` messages — an interrupted turn's dangling prompt, a PDH feedback
  // note (§3.5.13) — that must reach the model distinctly and must not be
  // folded (folding the interrupt-dangling turn even resurrects the abandoned
  // request).
  //
  // Collapse IN PLACE (not a folded copy): the persistent `messages` array is
  // reused for every later turn, so leaving the `[user, user]` pair in it would
  // re-break the SECOND live turn (which re-sends the lingering pair). The gated
  // turn is the first after resume, still tool-free (resumed history is
  // user/assistant/system only), so an in-place fold is safe and the helper
  // never folds `tool` turns regardless. Un-gated later turns are untouched, so
  // the intentional interrupt/feedback consecutive-`user` states are preserved.
  if (loopOptions.mergeRoles) {
    collapseConsecutiveMessagesInPlace(messages);
  }
  for await (const event of runLoop(messages, loopOptions)) {
    switch (event.type) {
      case "tool-executing": {
        // Additive protocol-v1 correlation id ("tu-<n>", session-scoped —
        // agent-sdk docs/PROTOCOL.md §1.2.1): the matching tool_result below
        // echoes the same id so UIs can pair calls without adjacency.
        const toolUseId = nextToolUseId ? nextToolUseId() : undefined;
        toolCalls.push({ id: toolUseId, tool: event.tool, args: event.args });
        emit({
          type: "tool_use",
          ...(toolUseId ? { id: toolUseId } : {}),
          tool: event.tool,
          args: event.args,
        });
        break;
      }
      case "tool-result": {
        const err = event.error || event.result?.error || null;
        // The loop runs tools serially, so this result settles the most
        // recent tool_use (same adjacency rule the is_error attribution
        // below has always used).
        const lastCall =
          toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null;
        if (lastCall) lastCall.is_error = Boolean(err);
        emit({
          type: "tool_result",
          ...(lastCall?.id ? { id: lastCall.id } : {}),
          tool: event.tool,
          is_error: Boolean(err),
          error: err,
          result: event.result,
        });
        break;
      }
      case "token-usage":
        // 用量归因: attributed child-loop usage (sub-agent / isolated skill)
        // is forwarded on the stream (same wire shape) and counted toward the
        // cost budget, but stays out of the turn's `usage` envelope, which
        // keeps its long-standing main-loop-only semantics.
        if (!event.attribution) {
          usage.input_tokens += event.usage?.input_tokens || 0;
          usage.output_tokens += event.usage?.output_tokens || 0;
          // Carry prompt-cache tokens into the turn's accumulated usage so the
          // final `result` envelope (read by IDE panels) reflects caching too.
          usage.cache_read_input_tokens +=
            event.usage?.cache_read_input_tokens || 0;
          usage.cache_creation_input_tokens +=
            event.usage?.cache_creation_input_tokens || 0;
        }
        emit({ type: "token_usage", usage: event.usage });
        if (costBudget) {
          costBudget.add({
            provider: event.provider,
            model: event.model,
            usage: event.usage,
          });
          if (costBudget.exceeded()) {
            endReason = "cost-budget-exhausted";
            stopForCost = true;
          }
        }
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
    // Hard cost cap reached — stop consuming the loop (break the for-await, not
    // just the switch) so no further paid LLM call is made.
    if (stopForCost) break;
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
  // Vision model (config.llm.visionModel) — image turns switch to it for that
  // turn only (resolveVisionLlm falls back to the default when unset), so a
  // pasted/typed image is read by a vision-capable model even though the
  // session's default model is text-only.
  let visionModel = options.visionModel;
  if (!visionModel) {
    try {
      const { loadConfig } = await import("../lib/config-manager.js");
      visionModel = loadConfig()?.llm?.visionModel || undefined;
    } catch {
      /* optional — resolveVisionLlm falls back to DEFAULT_VISION_MODEL */
    }
  }
  const cwd = options.cwd || process.cwd();
  const additionalDirectories = Array.isArray(options.additionalDirectories)
    ? options.additionalDirectories.filter(Boolean)
    : [];

  // .claude/settings.json permission rules (deny > ask > allow); see
  // runAgentHeadless for the full semantics. null = no file → unchanged.
  let permissionRules = options.permissionRules || null;
  let managedSettings = null;
  try {
    const { loadSettings, applyManagedPermissionPolicy } =
      await import("../lib/settings-loader.cjs");
    const loaded = loadSettings({
      cwd,
      settingsFile: options.settingsFile,
      managedSettingsFile: options.managedSettingsFile,
    });
    managedSettings = loaded.managed;
    if (!permissionRules) {
      const total =
        loaded.rules.allow.length +
        loaded.rules.ask.length +
        loaded.rules.deny.length;
      permissionRules = total > 0 ? loaded.rules : null;
    } else if (managedSettings) {
      permissionRules = applyManagedPermissionPolicy(
        permissionRules,
        managedSettings,
      );
    }
  } catch (error) {
    if (error?.code === "CC_MANAGED_SETTINGS_INVALID") throw error;
    // Preserve caller-provided rules; absent settings keep legacy behavior.
  }

  // .claude/settings.json `hooks` block (decision-capable PreToolUse/PostToolUse).
  let settingsHooks = options.settingsHooks || null;
  if (!settingsHooks) {
    try {
      const { loadHooks, projectHookTrustNotice } =
        await import("../lib/settings-hooks.cjs");
      const loaded = loadHooks({ cwd, settingsFile: options.settingsFile });
      settingsHooks =
        loaded.hooks && Object.keys(loaded.hooks).length > 0
          ? loaded.hooks
          : null;
      // First-run trust notice for an untrusted/cloned repo's shell-running
      // hooks (Claude-Code 2.1.195 parity). stderr keeps the NDJSON stdout clean.
      try {
        const notice = projectHookTrustNotice({
          cwd,
          settingsFile: options.settingsFile,
        });
        if (notice) process.stderr.write(notice + "\n");
      } catch {
        /* trust notice is best-effort */
      }
    } catch {
      settingsHooks = null; // fail-open
    }
  }

  // autoMode.classifyAllShell (Claude-Code 2.1.193): classify the built-in
  // verification allowlist through the shell-policy instead of fast-pathing it.
  let classifyAllShell = options.classifyAllShell || false;
  if (!classifyAllShell) {
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

  const input = deps.input || process.stdin;
  const runLoop = deps.agentLoop || coreAgentLoop;
  const doBootstrap = deps.bootstrap || bootstrap;
  const doExpand = deps.expandFileRefs || expandFileRefsAsync;
  const writeOut = deps.writeOut || ((s) => process.stdout.write(s));
  const writeErr = deps.writeErr || ((s) => process.stderr.write(s));
  // Guard the real stdout/stderr against a downstream `| head` closing the pipe
  // (unhandled async EPIPE → crash). Only when we own the streams (no injected
  // seams = production, not tests). Idempotent; shared with the -p runner.
  if (!deps.writeOut && !deps.writeErr) {
    installPipeSafety();
  }
  // Run-scoped cross-event trace id (additive protocol-v1, docs/PROTOCOL.md
  // §1.2.1): one id stamped on EVERY stdout line so a consumer can correlate
  // the whole run across Webview → Bridge → CLI logs, transcripts and
  // diagnostic bundles. The IDE bridge may thread its own id through
  // `--trace-id` / options.traceId / CC_TRACE_ID; otherwise a per-process id
  // is minted (unique even when two runs resume the same session_id).
  const traceId = resolveTraceId(options, process.env, deps);
  // Live field-gate for the capability handshake (docs/PROTOCOL.md §1.3): a
  // client `hello` narrowing the wire features flips these to suppress the
  // additive fields it can't parse. All true by default = current behavior
  // byte-for-byte; the coalescer reads it per line.
  const fieldGate = { seq: true, trace_id: true, tool_use_id: true };
  // Batch consecutive partial-message text/thinking deltas into one stream_event
  // line (Claude-Code 2.1.191 streaming-CPU optimization). `emit` flushes any
  // pending deltas before writing a non-delta line, so ordering is preserved;
  // CC_STREAM_COALESCE_MS=0 restores the per-token emit behavior.
  const streamCoalescer =
    deps.streamCoalescer ||
    createStreamCoalescer({
      writeOut,
      coalesceMs: resolveStreamCoalesceMs(options, process.env),
      traceId,
      fieldGate,
    });
  const emit = streamCoalescer.emit;

  const getApprovalGate =
    deps.getApprovalGate ||
    (async () => {
      const m = await import("../lib/session-core-singletons.js");
      return m.getApprovalGate();
    });

  if (managedSettings) {
    const { assertManagedPermissionMode } =
      await import("../lib/settings-loader.cjs");
    assertManagedPermissionMode(options.permissionMode, managedSettings);
  }
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
  // --ephemeral forces persistence OFF even with an explicit session id (the
  // id is kept for event correlation only; nothing is written or replayed).
  const persist = Boolean(options.sessionId) && options.ephemeral !== true;

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
  const settleApproval = (id, approve, via, incomingBinding = null) => {
    const p = pendingApprovals.get(id);
    if (!p) return;
    // Approval binding (authority §"权限来源与跨 Agent 授权边界"): an *approve*
    // verdict that carries a binding which does NOT match the one the request
    // advertised is stale / mis-routed / argument-tampered — reject it (deny,
    // fail closed) instead of green-lighting a different or changed tool call.
    // A verdict with no binding stays backward-compatible; a deny always wins.
    if (
      approve === true &&
      incomingBinding &&
      p.binding &&
      !verifyApprovalBinding(p.binding, incomingBinding)
    ) {
      pendingApprovals.delete(id);
      clearTimeout(p.timer);
      emit({
        type: "approval_resolved",
        id,
        approved: false,
        via: "binding-mismatch",
        session_id: sessionId,
      });
      p.resolve(false);
      return;
    }
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
      // Bind this approval request to the exact call it authorizes: the request
      // id, its normalized arguments, and the policy/rule in force. The digest
      // rides on `approval_request` so a UI/relay can echo it back on approve,
      // letting settleApproval reject a verdict meant for a different call.
      const binding = approvalBindingDigest({
        toolCallId: id,
        args:
          ctx.args ?? (ctx.command != null ? { command: ctx.command } : null),
        policyDigest: ctx.rule || ctx.riskLevel || ctx.risk || null,
      });
      const timer = setTimeout(
        () => settleApproval(id, false, "timeout"),
        approvalTimeoutMs,
      );
      timer.unref?.();
      pendingApprovals.set(id, { resolve, timer, binding });
      emit({
        type: "approval_request",
        id,
        session_id: sessionId,
        tool: ctx.tool || ctx.toolName || null,
        command: ctx.command || ctx.args?.command || null,
        risk: ctx.riskLevel || ctx.risk || null,
        rule: ctx.rule || null,
        reason: ctx.reason || null,
        binding,
      });
    });

  let approvalGate = null;
  try {
    approvalGate = await getApprovalGate();
    if (approvalGate && (options.permissionMode || "default") === "auto") {
      // autoMode.decisions: user-configured riskLevel → allow/ask/deny
      // classifier (same wiring as headless-runner). Only wrap when settings
      // customize the map so the unconfigured path stays byte-identical.
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
      approvalGate.setSessionPolicy?.(sessionId, perm.sessionPolicy);
      approvalGate.setConfirmer?.(
        interactive && perm.allowInteractiveApprovals
          ? interactiveConfirm
          : perm.confirmer,
      );
    }
  } catch {
    approvalGate = null;
  }

  // ── Interactive questions (ask_user_question round-trip; chat-panel UX) ────
  // Same structured pattern as approvals: when the consumer opts in (the IDE
  // panel sets CC_INTERACTIVE_QUESTIONS=1 in the child env), the model's
  // `ask_user_question` tool emits `question_request`, BLOCKS until a
  // {"type":"answer",id,answer} arrives on stdin, and times out gracefully
  // (CC_QUESTION_TIMEOUT_MS, default 180s) — the handler maps the timeout to
  // user_timeout so the model proceeds, never a hard failure. Off by default
  // (env unset / pipes) → agent-core gets no askUser → user_not_reachable, the
  // existing graceful "proceed autonomously" path. Backward-safe: an env var
  // (not a flag) means an old `cc` simply ignores it.
  const interactiveQuestions =
    options.interactiveQuestions === true ||
    process.env.CC_INTERACTIVE_QUESTIONS === "1";
  const pendingQuestions = new Map();
  let questionSeq = 0;
  const questionTimeoutMs =
    Number(process.env.CC_QUESTION_TIMEOUT_MS) > 0
      ? Number(process.env.CC_QUESTION_TIMEOUT_MS)
      : 180000;
  const settleQuestion = (id, answer, via) => {
    const p = pendingQuestions.get(id);
    if (!p) return;
    pendingQuestions.delete(id);
    clearTimeout(p.timer);
    emit({ type: "question_resolved", id, via, session_id: sessionId });
    p.resolve(answer);
  };
  const failQuestion = (id, via) => {
    const p = pendingQuestions.get(id);
    if (!p) return;
    pendingQuestions.delete(id);
    clearTimeout(p.timer);
    emit({ type: "question_resolved", id, via, session_id: sessionId });
    const e = new Error(`ask_user_question ${via}`);
    e.code = "USER_TIMEOUT"; // handler → user_timeout (model proceeds, not a failure)
    p.reject(e);
  };
  const interactionAskUser = ({
    question,
    options: qOptions,
    multiSelect,
    timeoutMs,
  } = {}) =>
    new Promise((resolve, reject) => {
      const id = `q-${++questionSeq}`;
      const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : questionTimeoutMs;
      const timer = setTimeout(() => failQuestion(id, "timeout"), ms);
      timer.unref?.();
      pendingQuestions.set(id, { resolve, reject, timer });
      emit({
        type: "question_request",
        id,
        session_id: sessionId,
        question: typeof question === "string" ? question : "",
        options: Array.isArray(qOptions) ? qOptions : null,
        multiSelect: multiSelect === true,
      });
    });

  // --output-style (or settings.json `outputStyle`) persona, appended.
  let outputStyleBody = null;
  try {
    const { resolveOutputStyle } = await import("../lib/output-styles.js");
    const st = resolveOutputStyle(options.outputStyle, cwd);
    if (st && st.body) outputStyleBody = st.body;
  } catch {
    outputStyleBody = null;
  }
  // Large-monorepo context lever: `instructionExcludes` (settings.json or an
  // explicit caller/SDK option) suppresses instruction/rule/@import files that
  // resolve into excluded subtrees. Explicit option wins; else union settings.
  let instructionExcludes = Array.isArray(options.instructionExcludes)
    ? options.instructionExcludes
    : null;
  if (!instructionExcludes) {
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
  // --json-schema (P2 §"JSON Schema 与流式结构化结果"): resolve + meta-validate
  // the schema up front (fail-fast on a broken contract, mirroring the
  // single-prompt path), then inject its output contract into the system prompt
  // so the model's final reply is JSON. A per-turn `structured_result` event is
  // emitted after each turn below. Off by default → nothing changes.
  let _jsonSchema = null;
  let _jso = null;
  if (options.jsonSchema) {
    try {
      _jso = await import("../lib/json-schema-output.js");
      _jsonSchema = _jso.loadSchemaFile(_jso._deps.fs, options.jsonSchema);
    } catch (err) {
      // Fail-fast, exactly like `cc agent -p --json-schema` on a bad schema.
      writeErr(`Error: ${err.message}\n`);
      return { exitCode: 1, turns: 0 };
    }
  }

  // --no-project-memory (options.projectMemory === false) → lean system prompt:
  // skip both the rules.md append inside buildSystemPrompt AND the auto-loaded
  // cc.md/CLAUDE.md instruction block. Only `=== false` changes anything; when
  // the flag is absent (undefined) both paths stay byte-identical.
  const _leanNoProjectMemory = options.projectMemory === false;
  const systemContent = composeSystemPrompt(
    buildSystemPrompt(cwd, {
      additionalDirectories,
      projectMemory: options.projectMemory,
    }),
    {
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: _jsonSchema
        ? [options.appendSystemPrompt, _jso.buildSchemaInstruction(_jsonSchema)]
            .filter(Boolean)
            .join("\n\n")
        : options.appendSystemPrompt,
      outputStyle: outputStyleBody,
      instructionExcludes,
      projectMemory: _leanNoProjectMemory ? false : undefined,
    },
  );
  const messages = [{ role: "system", content: systemContent }];

  // §3.5.13 flywheel consumption (design module 101): in a PDH session, lead
  // with the user's standing feedback preferences learned ACROSS sessions
  // (corrections + net sentiment) so the agent honours past corrections from
  // the very first turn — the read side of pdh-feedback-ledger.js. Gated to PDH
  // context (the in-APK chat sets CHAINLESSCHAIN_PDH_PORT; `--pdh` forces,
  // `--no-pdh` opts out) so IDE/coding sessions are never polluted. Best-effort.
  // PDH context gate — reused by the §3.5.13 flywheel injection below and the
  // §3.5.18 egress reporting after each turn (in-APK chat sets
  // CHAINLESSCHAIN_PDH_PORT; `--pdh` forces, `--no-pdh` opts out).
  let pdhContext = false;
  try {
    const { isInPdhTerminal } = await import("../lib/pdh-bridge.js");
    pdhContext =
      options.pdh === true ||
      (options.pdh !== false && isInPdhTerminal(process.env));
    if (pdhContext) {
      const { readFeedback, summarizeFeedback, feedbackSystemNote } =
        await import("../lib/pdh-feedback-ledger.js");
      const note = feedbackSystemNote(summarizeFeedback(readFeedback()));
      if (note) messages.push({ role: "system", content: note });
    }
  } catch {
    /* learned-preference injection must never break the chat */
  }

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

  // Resume-degenerate role sanitation (Claude Code 2.1.187 parity): when the
  // replayed history ends with a bare `user` turn (the prior run produced no
  // assistant response), the FIRST live prompt would make two adjacent `user`
  // messages. Arm a one-shot flag consumed by the first model call so the merge
  // fires exactly once — the live turn loop's intentional consecutive-`user`
  // states (interrupt-dangling turn, PDH feedback note) are never folded.
  let sanitizeRolesNextTurn =
    resumedMessages > 0 && messages[messages.length - 1]?.role === "user";

  emit({
    type: "system",
    subtype: "init",
    // Deterministic-headless manifest (gap-analysis 2026-07-11): protocol
    // version + persistence + live sources + policy/tool digests. The init
    // event fires BEFORE MCP resolution here (stream consumers expect it
    // promptly), so `mcp` in loaded_sources reflects the run's MCP intent
    // (config file / registry auto-connect enabled), not connection outcome.
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
      disallowedTools: disabledTools,
      permissionRules,
    }),
    loaded_sources: buildLoadedSources({
      permissionRules,
      settingsHooks,
      mcp: Boolean(options.mcpConfig) || options.useRegisteredMcp !== false,
      enabledToolNames,
    }),
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
          managedSettingsFile: options.managedSettingsFile,
          db: db?.getDatabase?.() || null,
          includeRegistered: options.useRegisteredMcp !== false,
          // --strict-mcp-config: only the --mcp-config servers (ignore
          // registered + IDE bridge) for a reproducible MCP surface.
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
          loadMcpConfig: deps.loadMcpConfig,
          loadRegisteredMcp: deps.loadRegisteredMcp,
          loadIdeMcp: deps.loadIdeMcp,
          loadJetbrainsMcp: deps.loadJetbrainsMcp,
        },
      );
      // MCP tool search (context scaling): defer big tool schemas behind the
      // internal tool_search tool. Below-threshold / disabled → no-op.
      if (mcp) {
        try {
          (deps.maybeApplyToolSearch || maybeApplyToolSearch)(mcp, {
            model,
            provider,
            cwd: options.cwd || process.cwd(),
            writeErr,
          });
        } catch {
          // best-effort — full schemas still work without deferral
        }
      }
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

  // --remote-control: route CONFIRM-tier approvals to paired mobile/web
  // devices (第四阶段 #2). Pairing info is emitted as a stream event so panel
  // hosts can render the QR. --permission-prompt-tool and --interactive-
  // approvals win when given (this block skips) — explicit routing beats the
  // ambient device bridge.
  let _remoteApproval = null;
  if (
    options.remoteControl &&
    !options.permissionPromptTool &&
    options.interactiveApprovals !== true
  ) {
    try {
      const { startHeadlessRemoteApproval } =
        await import("../lib/remote-approval-bridge.js");
      _remoteApproval = await startHeadlessRemoteApproval({
        agentSessionId: sessionId,
      });
      emit({
        type: "remote_control",
        subtype: "pairing",
        pairing_uri: _remoteApproval.pairing.uri,
        remote_session_id: _remoteApproval.pairing.remoteSessionId,
        expires_at: _remoteApproval.pairing.expiresAt,
      });
      if (approvalGate && typeof approvalGate.setConfirmer === "function") {
        approvalGate.setConfirmer(_remoteApproval.confirmer);
      }
    } catch (err) {
      emit({
        type: "remote_control",
        subtype: "unavailable",
        error: err.message,
      });
      _remoteApproval = null;
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
    // Auto-checkpoint (Claude-Code parity): snapshot the work tree before each
    // mutating tool so a stream consumer (e.g. the IDE chat panel) can rewind.
    // Keyed by this run's sessionId — agent-core falls back to it — so the panel
    // lists/restores with `cc checkpoint list|restore -s <sessionId>`. Off by
    // default (no behavior change for callers that don't opt in); git engine
    // only, a no-op outside a git repo.
    autoCheckpoint: options.autoCheckpoint || false,
    checkpointSession: options.checkpointSession || sessionId,
    hookDb: db,
    approvalGate,
    permissionRules,
    settingsHooks,
    classifyAllShell,
    enabledToolNames,
    disabledTools,
    // --interactive-approvals: settings/hook `ask` (and, with an IDE bridge,
    // edit reviews via openDiff) route to the structured approval round-trip
    // instead of failing closed. Absent in CI/pipes → unchanged fail-closed.
    permissionConfirm: interactive ? interactiveConfirm : undefined,
    // ask_user_question round-trip (opt-in via CC_INTERACTIVE_QUESTIONS): give
    // the tool handler an askUser that emits question_request + blocks on stdin.
    // Absent → agent-core returns user_not_reachable (graceful proceed).
    interaction: interactiveQuestions
      ? { askUser: interactionAskUser }
      : undefined,
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
      ? (text) => streamCoalescer.emitTextDelta(text)
      : undefined,
    // Extended-thinking reasoning deltas (Anthropic; only when thinking is on).
    // Surfaced as a thinking_delta so consumers can render a dimmed/collapsed
    // reasoning block — the visible half of the /think toggle.
    onThinking: options.includePartialMessages
      ? (thinking) => streamCoalescer.emitThinkingDelta(thinking)
      : undefined,
    // Auto-retry notice (Claude-Code 2.1.181): the streaming call hit a
    // transient API connection drop and is retrying. Surfaced unconditionally
    // (not gated on --include-partial-messages) so programmatic NDJSON
    // consumers can log/monitor reconnects rather than seeing an opaque pause.
    onStreamRetry: (attempt) =>
      emit({
        type: "stream_retry",
        attempt,
        message: "API connection dropped — retrying",
      }),
    // Visible cross-vendor fallback notice: when the configured provider hits an
    // auth error and the loop falls back to another vendor (or relabels via
    // baseUrl), surface it as a `raw` info line the panel renders instead of a
    // silent vendor switch. Structured fields carry the machine-readable detail.
    onProviderFallback: (info) =>
      emit({
        type: "raw",
        subtype: "provider_fallback",
        text: `⚠️ ${info.message || `已从 "${info.from}" 切换到 "${info.to}"`}`,
        from: info.from,
        to: info.to,
        reason: info.reason,
        session_id: sessionId,
      }),
  };

  // --max-budget-usd: a SESSION-WIDE USD spend cap across all turns. Folded
  // from token-usage in runTurn; once reached the session ends before the next
  // paid call. null → no cap (unchanged behavior).
  const costBudget = options.maxCostUsd
    ? new CostBudget({
        limitUsd: options.maxCostUsd,
        table: options.priceTable,
      })
    : null;

  let turns = 0;
  let sawError = false;
  // Session-scoped tool-call correlation ids ("tu-<n>", additive protocol-v1
  // field): one counter across ALL turns so ids never repeat within a session.
  // Gated by the capability handshake (docs/PROTOCOL.md §1.3): a client that
  // negotiated tool_use_id off gets undefined (no `id` field emitted).
  let toolUseCounter = 0;
  const nextToolUseId = () =>
    fieldGate.tool_use_id === false ? undefined : `tu-${++toolUseCounter}`;
  // Version-skew notice (friendly reminder): a chat-panel agent process is
  // long-lived, so if cc was updated on disk while it kept running, it's still
  // executing stale in-memory code (a fixed bug then looks "not fixed"). Checked
  // each turn until detected so a mid-session `npm i -g` is caught on the next
  // message; emitted ONCE as a `raw` line the panel already renders.
  let versionSkewNotified = false;
  // Once any turn attaches an image, the image stays in the conversation
  // history — so every later turn (even a text-only follow-up like "what colour
  // is it?") must keep using the vision LLM, otherwise a text-only default model
  // is handed image content it can't read. Claude Code never hits this (one
  // multimodal model); cc splits text/vision models, so we sticky the routing.
  let conversationHasImages = false;

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
        if (parsed.hello) {
          // Capability handshake (docs/PROTOCOL.md §1.3): negotiate the client's
          // offer against this CLI's, apply the agreed feature set to the live
          // field-gate, and echo the result. Never queued (it's out-of-band
          // control, like interrupt/approval). Incompatible (ok:false) leaves
          // the gate untouched — the CLI keeps its safe baseline.
          const negotiated = negotiateProtocol(
            buildServerOffer(buildAgentCapabilities()),
            parsed.hello,
          );
          applyNegotiationToGate(negotiated, fieldGate);
          emit({
            type: "system",
            subtype: "negotiated",
            session_id: sessionId,
            protocol_version: negotiated.agreedVersion,
            features: negotiated.features,
            downgraded: negotiated.downgraded,
            disabled_features: negotiated.disabledFeatures,
            ok: negotiated.ok,
            reason: negotiated.reason,
          });
          continue;
        }
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
            parsed.approval.binding,
          );
          continue;
        }
        if (parsed.answer) {
          // Answers settle a BLOCKED ask_user_question — never queued. A null
          // value (user cancelled the QuickPick) → user_timeout (model proceeds).
          if (parsed.answer.value == null)
            failQuestion(parsed.answer.id, "cancelled");
          else
            settleQuestion(
              parsed.answer.id,
              parsed.answer.value,
              "user-answer",
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
    // stdin closed while a question was pending → user_timeout (model proceeds).
    for (const id of [...pendingQuestions.keys()]) {
      failQuestion(id, "stdin-closed");
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

    // One-time version-skew reminder (see flag declaration above). Best-effort;
    // never blocks a turn. detectVersionSkew() returns null when this process is
    // running the currently-installed version, so a fresh/up-to-date session
    // stays quiet.
    if (!versionSkewNotified) {
      try {
        const skew = detectVersionSkew();
        if (skew) {
          versionSkewNotified = true;
          emit({
            type: "raw",
            subtype: "version_skew",
            text: `⚠️ ${versionSkewMessage(skew)}`,
            running_version: skew.loaded,
            installed_version: skew.installed,
            session_id: sessionId,
          });
        }
      } catch {
        /* version-skew notice is best-effort */
      }
    }

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

    // Manual `/compact` (Claude-Code IDE parity): trim the live history in
    // place between turns — no LLM call (microCompact shortens large old tool
    // results, preserving recent turns + tool pairs). Answers with a
    // `compaction` event the panel renders as "compacted N→M, saved …".
    if (parsed.compact) {
      const { microCompact } = await import("../lib/micro-compact.js");
      const before = messages.length;
      const { messages: compacted, stats } = microCompact(messages);
      messages.length = 0;
      messages.push(...compacted);
      emit({
        type: "compaction",
        stats,
        messages_before: before,
        messages_after: messages.length,
      });
      continue;
    }

    // Plan-mode control events (chat-panel plan UI). Mirrors the REPL's
    // /plan verbs: enter blocks write tools (blocked calls become plan items),
    // approve unlocks them and IMMEDIATELY runs a continuation turn, reject
    // exits plan mode. Every control answers with a `plan_update` event.
    if (parsed.plan) {
      const pm = getPlanModeManager();
      const reviewMessage =
        parsed.plan === "approve" || parsed.plan === "reject"
          ? planReviewSystemMessage(parsed.planReview)
          : null;
      if (reviewMessage) {
        messages.push({ role: "system", content: reviewMessage });
      }
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

    // PDH self-learning feedback (design module 101 §3.5.13). Always ack so the
    // chat app can confirm receipt. A `correction` re-drives a turn so the model
    // adapts within the session; `positive`/`negative` are recorded as a
    // lightweight preference note in history without forcing a fresh reply.
    if (parsed.feedback) {
      const { turnId, kind, comment } = parsed.feedback;
      emit({
        type: "feedback_ack",
        turn_id: turnId,
        kind,
        session_id: sessionId,
      });
      // §3.5.13: persist to the cross-session learning ledger so the next
      // session can honour the user's standing preferences ("越用越聪明"
      // flywheel). Best-effort — a learning ledger must never break the chat.
      try {
        const { appendFeedback } =
          await import("../lib/pdh-feedback-ledger.js");
        appendFeedback({ sessionId, turnId, kind, comment });
      } catch {
        /* persistence is best-effort */
      }
      if (kind === "correction") {
        parsed.text = comment
          ? `用户对上一轮回复给出纠正：${comment}\n请据此调整并重新回复。`
          : "用户认为上一轮回复需要纠正，请反思后给出更准确的回复。";
        // fall through into the normal turn machinery with the correction prompt
      } else {
        const tag = kind === "positive" ? "认可" : "不满意";
        messages.push({
          role: "user",
          content: `（用户反馈：对上一轮回复表示${tag}。请在后续回复中延续/修正此偏好。）`,
        });
        continue;
      }
    }

    // PDH guided-collection resume (design module 101 §3.5.15). A PDH tool
    // returned assist_required (e.g. "log into the app first"); the chat's 引导卡
    // sends a resume once the user finishes or skips the in-app step. Ack so the
    // app can dismiss the card, then re-drive the model to retry (completed) or
    // move on (skip).
    if (parsed.resume) {
      const { token, action } = parsed.resume;
      emit({ type: "resume_ack", token, action, session_id: sessionId });
      parsed.text =
        action === "skip"
          ? "我跳过了刚才需要的引导操作，请不要重试该步骤，继续处理其它事项或做个小结。"
          : "我已完成刚才需要的引导操作，请重试刚才的采集/操作。";
      // fall through into the normal turn machinery with the continuation prompt
    }

    // --replay-user-messages: echo each accepted user message back on the
    // output stream (Claude-Code parity) so a consumer can correlate replies to
    // inputs / log the transcript. Echoes the raw user text, before @file or
    // IDE-context expansion.
    if (options.replayUserMessages && parsed.text) {
      emit({
        type: "user",
        message: { role: "user", content: parsed.text },
        session_id: sessionId,
      });
    }

    // Per-turn iteration budget so one turn can't starve the rest.
    const budget = Number.isFinite(options.maxTurns)
      ? new IterationBudget({
          limit: Math.max(1, Math.floor(options.maxTurns)),
        })
      : new IterationBudget();

    // Custom slash-command macro expansion per user event (Claude-Code parity:
    // a /name from .claude/commands runs in panel / stream mode too, not just
    // the REPL). expandCommand already runs @file expansion, so the @-ref pass
    // below is skipped when a macro matched. Opt out: options.slashMacros:false.
    let userContent = parsed.text;
    let slashExpanded = false;
    // A matched command's `model:` / `allowed-tools:` frontmatter scopes THIS
    // turn's loopOptions below (parity with `cc command run` / headless -p).
    let turnMacroModel = null;
    let turnMacroTools = null;
    if (
      options.slashMacros !== false &&
      typeof parsed.text === "string" &&
      parsed.text.startsWith("/")
    ) {
      try {
        const doMacro =
          deps.resolveSlashMacro ||
          (await import("../repl/slash-macro.js")).resolveSlashMacro;
        const macro = await doMacro(parsed.text, { cwd });
        if (macro && macro.matched) {
          userContent = macro.promptText;
          slashExpanded = true;
          for (const w of macro.warnings || []) {
            writeErr(`  /${macro.name}: ${w}\n`);
          }
          writeErr(`  command: /${macro.name} [${macro.scope}]\n`);
          if (macro.model) {
            turnMacroModel = macro.model;
            writeErr(`  command: model → ${turnMacroModel}\n`);
          }
          if (macro.allowedTools) {
            turnMacroTools = parseToolList(macro.allowedTools);
          }
        }
      } catch {
        // macro resolution is best-effort — fall back to the literal text
      }
    }

    // @file expansion per user event (parity with single-turn headless).
    // Skipped when a slash macro already expanded (expandCommand ran @refs).
    if (!slashExpanded && options.expandFileRefs !== false) {
      const expanded = await doExpand(parsed.text, { cwd });
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
      const ideCtx = await (
        deps.buildIdePromptContext || buildIdePromptContext
      )(mcp);
      if (ideCtx) userContent += `\n\n${ideCtx}`;
      // Explicit @selection / @diagnostics mentions (Claude-Code parity);
      // scan the original user event text, append the expansion ephemerally.
      const mentioned = await expandIdeMentions(parsed.text, mcp);
      for (const w of mentioned.warnings) writeErr(`  @ide: ${w}\n`);
      if (mentioned.block) userContent += `\n\n${mentioned.block}`;
    } catch {
      // optional polish — never fail the turn over it
    }

    // Attach pasted/added images (panel parity with `--image`): file paths →
    // data URLs → OpenAI-style multimodal content. buildUserContent returns
    // the plain string when there are no images, so text turns are unchanged.
    // On an image turn, also switch THIS turn to the vision LLM (model only —
    // same account/key) so it's read by a vision-capable model.
    let turnContent = userContent;
    if (parsed.images && parsed.images.length) {
      try {
        turnContent = buildUserContent(
          userContent,
          resolveImages(parsed.images),
        );
        conversationHasImages = true;
      } catch (err) {
        emit({
          type: "result",
          subtype: "error",
          is_error: true,
          result: `image attach failed: ${err.message}`,
          session_id: sessionId,
        });
        continue; // bad attachment kills the turn, not the session
      }
    }
    // Route to the vision LLM (model only — same provider/account/key/baseUrl)
    // on any turn that carries an image AND on every later turn once the
    // conversation holds an image, so a text-only follow-up about the image
    // isn't sent to a text-only default model that can't read the history.
    let turnVisionLlm = null;
    if (conversationHasImages) {
      turnVisionLlm = resolveVisionLlm({
        hasImage: true,
        flags: {},
        llm: { provider, baseUrl, apiKey, visionModel },
      });
      if (parsed.images && parsed.images.length) {
        writeErr(
          `  [image] ${parsed.images.length} attached → vision model ${turnVisionLlm.model}\n`,
        );
      }
    }

    // §3.5.10 接线6: explicit per-turn LLM override (PDH privacy-tier switch).
    // Applies to THIS turn only; the vision override (above) still wins on image
    // turns since an image needs a vision-capable model.
    const turnLlmOverride = parsed.llm || null;
    if (turnLlmOverride && !turnVisionLlm) {
      writeErr(
        `  [llm] this turn → ${turnLlmOverride.provider || provider}/${
          turnLlmOverride.model || "(session model)"
        }\n`,
      );
    }

    messages.push({ role: "user", content: turnContent });
    if (persist) {
      try {
        store.appendUserMessage(sessionId, turnContent);
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

    // Consume the one-shot resume-degeneracy flag for THIS turn (see
    // sanitizeRolesNextTurn) so the role merge fires exactly once, whether the
    // model call completes or is interrupted.
    const mergeRolesThisTurn = sanitizeRolesNextTurn;
    sanitizeRolesNextTurn = false;

    let outcome;
    try {
      outcome = await runTurn(
        messages,
        {
          ...loopOptionsBase,
          // Custom-command frontmatter scopes THIS turn (parity with `cc command
          // run` / headless -p): a matched /name applies its model: and
          // allowed-tools:. Lowest-priority override — an explicit per-turn
          // privacy (turnLlmOverride) or vision (turnVisionLlm) switch below
          // still wins on model.
          ...(turnMacroModel ? { model: turnMacroModel } : {}),
          ...(turnMacroTools ? { enabledToolNames: turnMacroTools } : {}),
          // §3.5.10 接线6: explicit per-turn LLM override (privacy-tier switch);
          // only the fields provided are overridden (e.g. provider+model+baseUrl
          // to route to your own PC Ollama for one turn).
          ...(turnLlmOverride
            ? {
                ...(turnLlmOverride.provider
                  ? { provider: turnLlmOverride.provider }
                  : {}),
                ...(turnLlmOverride.model
                  ? { model: turnLlmOverride.model }
                  : {}),
                ...(turnLlmOverride.baseUrl
                  ? { baseUrl: turnLlmOverride.baseUrl }
                  : {}),
                ...(turnLlmOverride.apiKey
                  ? { apiKey: turnLlmOverride.apiKey }
                  : {}),
              }
            : {}),
          // Image turn → switch this turn's provider/model/baseUrl/apiKey to
          // the vision LLM (model only; same account/key/baseUrl). Wins over an
          // explicit llm override above (an image needs a vision model).
          ...(turnVisionLlm
            ? {
                provider: turnVisionLlm.provider,
                model: turnVisionLlm.model,
                baseUrl: turnVisionLlm.baseUrl,
                apiKey: turnVisionLlm.apiKey,
              }
            : {}),
          iterationBudget: budget,
          signal: turnSignal,
          // Resume-degenerate role merge for the first live model call only.
          mergeRoles: mergeRolesThisTurn,
        },
        { runLoop, emit, costBudget, nextToolUseId },
      );
    } catch (err) {
      currentAbort = null;
      const isAbort =
        err?.name === "AbortError" || /abort/i.test(err?.message || "");
      if (isAbort && !options.signal?.aborted) {
        // User-initiated turn interrupt — not an error; no assistant message
        // is recorded (the dangling user turn is fine for the next exchange).
        //
        // BUT if the interrupt landed mid-tool-loop, `messages` now holds an
        // assistant turn whose tool_calls never got their results — sending
        // that next turn makes strict providers (Anthropic) reject the whole
        // request ("tool_use without tool_result"), wedging the rest of the
        // session. Drop the dangling call/result pair in place before
        // continuing. Always re-balance (not gated on length): a partial
        // interrupt that trims one assistant turn's tool_calls in place leaves
        // the array length unchanged. sanitizeToolPairs is idempotent on an
        // already-balanced array and leaves user/text turns untouched, so the
        // intentional dangling-user state above is preserved.
        const balanced = sanitizeToolPairs(messages);
        messages.length = 0;
        messages.push(...balanced);
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

    // §3.5.18 出境台账: report what left the device this turn (the cloud-LLM
    // call + any egress-classed tool) so the Android transparency ledger —
    // which cannot see the cc subprocess's cloud call — records it. PDH-gated
    // and emit-only (cc never keeps its own ledger; it stays a single on-device
    // encrypted store). A local-only turn emits nothing — the honest "0 条出境".
    // Uses the EFFECTIVE per-turn LLM (a §3.5.10 privacy-tier / vision override
    // is exactly the egress-relevant decision).
    if (pdhContext) {
      try {
        const { turnEgressEvents } = await import("../lib/pdh-egress.js");
        const effProvider =
          turnVisionLlm?.provider || turnLlmOverride?.provider || provider;
        const effModel =
          turnVisionLlm?.model || turnLlmOverride?.model || model;
        const effBaseUrl =
          turnVisionLlm?.baseUrl || turnLlmOverride?.baseUrl || baseUrl;
        for (const ev of turnEgressEvents({
          provider: effProvider,
          baseUrl: effBaseUrl,
          model: effModel,
          toolCalls: outcome.toolCalls,
          usage: outcome.usage,
          sessionId,
          turn: turns,
        })) {
          emit(ev);
        }
      } catch {
        /* egress reporting is best-effort — never break the chat */
      }
    }

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
    const costStopped = outcome.endReason === "cost-budget-exhausted";
    const isError =
      exhausted || costStopped || outcome.endReason === "no-response";
    if (isError) sawError = true;

    if (costStopped) {
      emit({
        type: "cost_budget_exhausted",
        limit_usd: options.maxCostUsd,
        spent_usd: costBudget?.spentUsd,
        session_id: sessionId,
        turn: turns,
      });
    }

    emit({
      type: "result",
      subtype: exhausted
        ? "error_max_turns"
        : costStopped
          ? "error_max_budget"
          : isError
            ? "error"
            : "success",
      is_error: isError,
      result: outcome.finalText,
      session_id: sessionId,
      turn: turns,
      usage: outcome.usage,
    });

    // --json-schema (P2): emit this turn's structured verdict right after its
    // result — schema_digest + valid + value/errors from the turn's final text.
    // Never falls back to free text; an unparseable/invalid reply reports
    // valid:false with coded/pointered errors. Parity with single-prompt output.
    if (_jsonSchema) {
      const parsed = _jso.extractJsonPayload(String(outcome.finalText ?? ""));
      emit({
        ..._jso.buildStructuredResult(
          _jsonSchema,
          parsed.ok ? parsed.value : null,
        ),
        session_id: sessionId,
        turn: turns,
      });
    }

    // Session-wide cost cap reached → stop accepting further turns.
    if (costStopped) break;

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

  // Tear down the --remote-control approval bridge + its self-hosted WS
  // server so the stream session's port never outlives the invocation.
  if (_remoteApproval) {
    try {
      await _remoteApproval.close();
    } catch {
      // best-effort
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
