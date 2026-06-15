/**
 * Map the CLI's stream-json NDJSON events onto the small message vocabulary
 * the chat webview renders. Pure + stateful-per-turn (the reducer tracks
 * whether text deltas streamed this turn so the final `result` text is not
 * rendered twice). No `vscode`, fully unit-testable.
 *
 * UI message kinds:
 *   init       { model, provider, sessionId }
 *   delta      { text }                    streaming assistant text
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
      return null;
    }
    case "tool_use":
      return {
        kind: "tool",
        tool: evt.tool || "?",
        summary: summarizeToolArgs(evt.args),
      };
    case "tool_result":
      return {
        kind: "tool_done",
        tool: evt.tool || "?",
        isError: evt.is_error === true,
      };
    case "compaction":
      return {
        kind: "info",
        text: `compacted: saved ${evt.stats?.saved ?? "?"} tokens`,
      };
    case "result": {
      const sawDelta = state.sawDelta;
      state.sawDelta = false; // reset for the next turn
      if (evt.subtype === "interrupted" || evt.interrupted === true) {
        return { kind: "turn_end", isError: false, text: "⏹ interrupted", usage: null };
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
    case "plan_update":
      return {
        kind: "plan",
        active: evt.active === true,
        state: evt.state || null,
        items: Array.isArray(evt.items) ? evt.items : [],
        risk: evt.risk || null,
        note: evt.note || null,
      };
    case "session_error":
      return { kind: "error", text: evt.error || "agent session error" };
    case "raw":
      return { kind: "info", text: evt.text };
    default:
      return null; // token_usage, iteration_warning, … — UI-silent for now
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
function buildSessionArgs({ model, provider, resume, mode, think } = {}) {
  const args = [];
  if (typeof provider === "string" && provider.trim()) {
    args.push("--provider", provider.trim());
  }
  if (typeof model === "string" && model.trim()) {
    args.push("--model", model.trim());
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
  return args;
}

module.exports = {
  mapAgentEvent,
  createTurnState,
  summarizeToolArgs,
  buildSessionArgs,
  PERMISSION_MODES,
};
