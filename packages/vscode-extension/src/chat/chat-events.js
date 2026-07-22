/**
 * Map the CLI's stream-json NDJSON events onto the small message vocabulary
 * the chat webview renders. Pure + stateful-per-turn (the reducer tracks
 * whether text deltas streamed this turn so the final `result` text is not
 * rendered twice). No `vscode`, fully unit-testable.
 *
 * UI message kinds:
 *   init       { model, provider, sessionId }
 *   delta      { text }                    streaming assistant text
 *   thinking   { text }                    streaming extended-thinking reasoning
 *   tool       { tool, summary }           a tool call started
 *   tool_done  { tool, isError }           …finished
 *   info       { text }                    compaction / misc one-liners
 *   turn_end   { isError, text|null, usage } text only when nothing streamed
 *   error      { text }                    session-level failure
 */

/** One-line argument summary for the tool trace (mirrors the CLI's trace). */
function summarizeToolArgs(args) {
  if (!args || typeof args !== "object") return "";
  const s =
    args.path ||
    args.command ||
    args.pattern ||
    args.query ||
    args.url ||
    args.code ||
    "";
  const str = String(s);
  return str.length > 80 ? str.slice(0, 80) + "…" : str;
}

function createTurnState() {
  return { sawDelta: false };
}

/**
 * @param {object} evt    one parsed NDJSON event from the agent child
 * @param {object} state  per-conversation state from createTurnState()
 * @returns {object|null} a UI message, or null when the event is UI-silent
 */
function mapAgentEvent(evt, state) {
  if (!evt || typeof evt !== "object") return null;
  switch (evt.type) {
    case "system":
      if (evt.subtype === "init") {
        return {
          kind: "init",
          model: evt.model || "",
          provider: evt.provider || "",
          sessionId: evt.session_id || "",
        };
      }
      return null;
    case "stream_event": {
      const delta = evt.event?.delta;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        state.sawDelta = true;
        return { kind: "delta", text: delta.text };
      }
      // Extended-thinking reasoning (Anthropic, when /think is on) — rendered
      // as a dimmed/collapsed block, separate from the answer text.
      if (
        delta?.type === "thinking_delta" &&
        typeof delta.thinking === "string"
      ) {
        return { kind: "thinking", text: delta.thinking };
      }
      return null;
    }
    case "tool_use":
      return {
        kind: "tool",
        tool: evt.tool || "?",
        summary: summarizeToolArgs(evt.args),
      };
    case "tool_result": {
      // `ask_user_question` normally round-trips through the in-panel question
      // card (question_request below; the panel always opts in via
      // CC_INTERACTIVE_QUESTIONS=1). An old `cc` that ignores the env var — or a
      // question the user never answers — degrades gracefully instead: the
      // handler returns {error:"user_not_reachable"} (or "user_timeout") and the
      // model proceeds autonomously. That is NOT a tool failure — don't paint a
      // scary red "✗ … failed"; surface a quiet note.
      const errText =
        typeof evt.error === "string"
          ? evt.error
          : evt.result && typeof evt.result.error === "string"
            ? evt.result.error
            : null;
      const benign =
        errText === "user_not_reachable" || errText === "user_timeout";
      return {
        kind: "tool_done",
        tool: evt.tool || "?",
        isError: evt.is_error === true && !benign,
        note: benign
          ? evt.tool === "ask_user_question"
            ? "couldn't ask interactively in the panel — proceeding autonomously"
            : "skipped — proceeding"
          : null,
      };
    }
    case "compaction":
      return {
        kind: "info",
        text: `compacted: saved ${evt.stats?.saved ?? "?"} tokens`,
      };
    case "result": {
      const sawDelta = state.sawDelta;
      state.sawDelta = false; // reset for the next turn
      if (evt.subtype === "interrupted" || evt.interrupted === true) {
        return {
          kind: "turn_end",
          isError: false,
          text: "⏹ interrupted",
          usage: null,
        };
      }
      // Budget stops (error_max_turns / error_max_budget) carry the FULL
      // final text in evt.result — repainting it as the error would duplicate
      // everything that already streamed, in red. Show the stop reason
      // instead (the dedicated budget events above carry the figures).
      if (
        evt.subtype === "error_max_turns" ||
        evt.subtype === "error_max_budget"
      ) {
        const reason =
          evt.subtype === "error_max_turns"
            ? "⏹ stopped: turn budget exhausted"
            : "⏹ stopped: cost budget exhausted";
        return {
          kind: "turn_end",
          isError: true,
          text: sawDelta
            ? reason
            : evt.result
              ? `${evt.result}\n${reason}`
              : reason,
          usage: evt.usage || null,
        };
      }
      return {
        kind: "turn_end",
        isError: evt.is_error === true,
        // If text streamed via deltas, the final result repeats it — drop it.
        text: evt.is_error
          ? evt.error || evt.result || "turn failed"
          : sawDelta
            ? null
            : evt.result || null,
        usage: evt.usage || null,
      };
    }
    case "approval_request":
      return {
        kind: "approval",
        id: evt.id,
        tool: evt.tool || null,
        command: evt.command || null,
        risk: evt.risk || null,
        rule: evt.rule || null,
        reason: evt.reason || null,
      };
    case "approval_resolved":
      return {
        kind: "approval_done",
        id: evt.id,
        approved: evt.approved === true,
        via: evt.via || null,
      };
    case "question_request":
      // ask_user_question round-trip (CC_INTERACTIVE_QUESTIONS): the agent is
      // BLOCKED waiting for the user. chat-view shows a native QuickPick and
      // replies {type:"answer",...}; the webview renders the question inline.
      const question = {
        kind: "question",
        id: evt.id,
        question: evt.question || "",
        options: Array.isArray(evt.options) ? evt.options : null,
        multiSelect: evt.multiSelect === true,
      };
      if (evt.metadata && typeof evt.metadata === "object") {
        question.metadata = evt.metadata;
        question.elicitation = evt.metadata.kind === "mcp_elicitation";
        question.requestedSchema =
          evt.metadata.requestedSchema || evt.requestedSchema || null;
        question.server = evt.metadata.server || null;
      }
      return question;
    case "question_resolved":
      return {
        kind: "info",
        text:
          evt.via === "user-answer"
            ? "✓ answered"
            : "ask_user_question: no answer — proceeding",
      };
    case "plan_update":
      return {
        kind: "plan",
        active: evt.active === true,
        state: evt.state || null,
        plan_id: evt.plan_id || null,
        plan_version: evt.plan_version || null,
        previous_plan_id: evt.previous_plan_id || null,
        items: Array.isArray(evt.items) ? evt.items : [],
        risk: evt.risk || null,
        execution_lock: evt.execution_lock || null,
        note: evt.note || null,
      };
    case "session_error":
      return { kind: "error", text: evt.error || "agent session error" };
    case "token_usage":
      // Per-LLM-call usage mid-turn — the webview accumulates these into a live
      // token counter on the status line (turn_end still carries the
      // authoritative turn total from the result envelope).
      return evt.usage && typeof evt.usage === "object"
        ? { kind: "usage", usage: evt.usage }
        : null;
    case "iteration_warning":
      return {
        kind: "info",
        text: "⚠ " + (evt.message || "approaching the iteration limit"),
      };
    case "stream_retry":
      // Transient API connection drop mid-stream — without this line the
      // reconnect loop is an unexplained "thinking…" stall.
      return {
        kind: "info",
        text:
          "⚠ " +
          (evt.message || "API connection dropped — retrying") +
          (Number.isFinite(evt.attempt) ? ` (attempt ${evt.attempt})` : ""),
      };
    case "iteration_budget_exhausted":
      return {
        kind: "info",
        text:
          "⏹ turn budget exhausted" +
          (Number.isFinite(evt.budget) ? ` (${evt.budget} turns)` : ""),
      };
    case "cost_budget_exhausted": {
      const spent = Number.isFinite(evt.spent_usd)
        ? `$${Number(evt.spent_usd).toFixed(2)}`
        : null;
      const limit = Number.isFinite(evt.limit_usd)
        ? `$${Number(evt.limit_usd).toFixed(2)}`
        : null;
      return {
        kind: "info",
        text:
          "⏹ cost budget exhausted" +
          (spent && limit ? ` (${spent} of ${limit})` : ""),
      };
    }
    case "checkpoint":
      // Auto-snapshot taken before a mutating tool (git shadow-commit). A terse
      // trace so `/rewind` has a visible anchor; the tool gives it context.
      return {
        kind: "info",
        text:
          "📸 snapshot" +
          (typeof evt.tool === "string" && evt.tool
            ? ` before ${evt.tool}`
            : ""),
      };
    case "raw":
      return { kind: "info", text: evt.text };
    default:
      return null; // unknown/UI-silent event types
  }
}

/**
 * Permission modes the panel can pass through to `cc agent --permission-mode`
 * (the panel's auto-accept / bypass selector — Claude-Code parity). "default"
 * (and anything unknown) emits NO flag, so the agent keeps its normal approval
 * flow. `plan` is accepted here for completeness, but the panel drives plan
 * mode live over the stdin protocol (the `plan` event), not at spawn time.
 */
const PERMISSION_MODES = new Set(["plan", "acceptEdits", "bypassPermissions"]);

/**
 * Extra CLI args for the chat child from user settings + stored session.
 * Empty/missing values fall through to the CLI's own config defaults
 * (pure; vscode-free). `resume` is the workspace's last chat session id —
 * passing it makes the CLI rebuild that conversation and keep appending to
 * it, so the panel survives restarts/reloads with full context. `mode` is the
 * conversation's approval mode (acceptEdits / bypassPermissions); "default"
 * or unset adds nothing. `think` toggles Anthropic extended thinking:
 * "on" → --think, "ultra" → --ultrathink (ignored by non-Anthropic providers);
 * "off"/unset adds nothing.
 */
/** Read the user's cc LLM config — the `llm` block of ~/.chainlesschain/config.json. */
function readCcLlmConfig() {
  try {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const p = path.join(os.homedir(), ".chainlesschain", "config.json");
    return (JSON.parse(fs.readFileSync(p, "utf8")) || {}).llm || {};
  } catch {
    return {}; // no/unreadable config → let the CLI resolve on its own
  }
}

/**
 * Resolve the panel's EFFECTIVE provider/model. A non-empty panel override
 * (`chainlesschain.chat.provider`/`.model`) always wins; when empty, fall back
 * to the user's cc config (~/.chainlesschain/config.json) and return it so the
 * caller can pass it EXPLICITLY as `--provider/--model`.
 *
 * Why explicit instead of letting the empty case fall through to the CLI's own
 * config resolution: the panel spawns `cc` with the IDE's full environment and
 * working directory, and a stale/ambient state there could otherwise make the
 * child resolve a different provider than the terminal — surfacing as a
 * spurious "Anthropic error: 401" when the user actually configured, say,
 * volcengine. Pinning the config value makes the panel deterministically match
 * `cc config`. `readConfig` is injectable for tests.
 */
function resolveChatLlm(
  { provider, model } = {},
  readConfig = readCcLlmConfig,
) {
  const llm = readConfig() || {};
  let p = typeof provider === "string" ? provider.trim() : "";
  let m = typeof model === "string" ? model.trim() : "";
  let baseUrl = "";
  let apiKey = "";
  if (!p && llm.provider) {
    p = String(llm.provider);
    if (!m && llm.model) m = String(llm.model);
  }
  // Carry the FULL llm block (baseUrl + apiKey, + model) when the effective
  // provider matches the configured one. The panel pins --provider/--model and
  // MUST also pass the endpoint + key: the CLI, seeing an explicit --provider,
  // skips config resolution and would otherwise drop a cloud provider's
  // baseUrl/key → the endpoint falls through to ollama ("配置了火山却 fetch
  // failed / 切到 ollama"). Same provider → its baseUrl/apiKey are exactly
  // right. A DIFFERENT explicit provider override carries neither (the user
  // owns that endpoint/key).
  if (p && llm.provider && p === String(llm.provider)) {
    if (!m && llm.model) m = String(llm.model);
    if (llm.baseUrl) baseUrl = String(llm.baseUrl);
    if (llm.apiKey) apiKey = String(llm.apiKey);
  }
  return { provider: p, model: m, baseUrl, apiKey };
}

function buildSessionArgs({
  model,
  provider,
  baseUrl,
  apiKey,
  resume,
  mode,
  think,
  goalCondition,
} = {}) {
  const args = [];
  if (typeof provider === "string" && provider.trim()) {
    args.push("--provider", provider.trim());
  }
  if (typeof model === "string" && model.trim()) {
    args.push("--model", model.trim());
  }
  // Pass the endpoint + key alongside the provider so the CLI doesn't drop a
  // cloud provider's credentials (it skips config when --provider is explicit).
  if (typeof baseUrl === "string" && baseUrl.trim()) {
    args.push("--base-url", baseUrl.trim());
  }
  if (typeof apiKey === "string" && apiKey.trim()) {
    args.push("--api-key", apiKey.trim());
  }
  if (typeof resume === "string" && resume.trim()) {
    args.push("--resume", resume.trim());
  }
  if (typeof mode === "string" && PERMISSION_MODES.has(mode.trim())) {
    args.push("--permission-mode", mode.trim());
  }
  const t = typeof think === "string" ? think.trim() : "";
  if (t === "ultra") args.push("--ultrathink");
  else if (t === "on") args.push("--think");
  if (typeof goalCondition === "string" && goalCondition.trim()) {
    args.push("--goal-condition", goalCondition.trim());
  }
  return args;
}

function buildIdeToolAdmission(source = "vscode-extension") {
  return {
    enforce: true,
    source,
    capabilityGranted: true,
    policyAllowed: true,
    permissionGranted: true,
    budgetOk: true,
    uiSupported: true,
    tools: {
      publish_artifact: { policyAllowed: false },
      notify: { policyAllowed: false },
    },
  };
}

module.exports = {
  mapAgentEvent,
  createTurnState,
  summarizeToolArgs,
  buildSessionArgs,
  buildIdeToolAdmission,
  resolveChatLlm,
  readCcLlmConfig,
  PERMISSION_MODES,
};
