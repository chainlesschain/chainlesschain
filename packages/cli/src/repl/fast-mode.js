/**
 * Fast mode — latency profile for the agent REPL (gap-2026-07-11 P2#12).
 *
 * Claude Code's `/fast` binds Opus fast mode. cc is multi-provider, so "fast"
 * is generalized to a latency profile the provider adapter applies to the next
 * turn:
 *   - drop extended thinking / shrink the reasoning budget (biggest latency win
 *     and provider-agnostic),
 *   - optionally swap to the provider's designated low-latency model — but only
 *     when the user has NOT pinned a model this session (never override an
 *     explicit choice), and always announce it,
 *   - surface the cost/quality tradeoff so the user knows what they traded.
 *
 * Pure core (command parse, fast-model table, plan resolution, status/tradeoff
 * rendering). The `/fast` controller in agent-repl owns turn state + config
 * persistence (`cli.fastMode`).
 */

/** Provider → designated low-latency model. Only well-known ones. */
export const KNOWN_FAST_MODELS = Object.freeze({
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  deepseek: "deepseek-chat",
  dashscope: "qwen-turbo",
  mistral: "mistral-small-latest",
  gemini: "gemini-2.0-flash",
});

export const FAST_TRADEOFF =
  "Faster + cheaper, but lower reasoning depth — turn it off for hard/multi-step work.";

/**
 * Parse `/fast [on|off|status|toggle]`. Returns null when the input is not a
 * `/fast` command, `{ error }` for a bad arg, else `{ action }`. Bare `/fast`
 * toggles. Pure.
 */
export function parseFastCommand(input) {
  const t = String(input || "").trim();
  if (t !== "/fast" && !t.startsWith("/fast ")) return null;
  const arg = t.slice("/fast".length).trim().toLowerCase();
  if (!arg) return { action: "toggle" };
  if (["on", "enable", "1"].includes(arg)) return { action: "on" };
  if (["off", "disable", "0"].includes(arg)) return { action: "off" };
  if (["status", "state"].includes(arg)) return { action: "status" };
  if (arg === "toggle") return { action: "toggle" };
  return { error: `Unknown /fast option "${arg}". Use: on | off | status` };
}

/**
 * Resolve the effect of the current fast-mode state on the next turn.
 * @param {object} o { enabled, provider, model, modelPinned }
 *   modelPinned = the user chose the model this session (`/model x`), so we must
 *   not swap it.
 * @returns {{ enabled, thinking, model, swapped, note, tradeoff }}
 * When disabled, returns the inputs unchanged with thinking left null (caller
 * keeps its own thinking state). Pure.
 */
export function resolveFastPlan({
  enabled = false,
  provider = "",
  model = "",
  modelPinned = false,
} = {}) {
  if (!enabled) {
    return {
      enabled: false,
      thinking: null,
      model,
      swapped: false,
      note: "",
      tradeoff: "",
    };
  }
  const fast = KNOWN_FAST_MODELS[String(provider).toLowerCase()];
  const canSwap = Boolean(fast) && !modelPinned && fast !== model;
  const nextModel = canSwap ? fast : model;
  let note;
  if (canSwap) {
    note = `Fast mode: low-latency model ${nextModel}, reasoning minimized.`;
  } else if (modelPinned) {
    note = `Fast mode: reasoning minimized (keeping your pinned model ${model}).`;
  } else {
    note = "Fast mode: reasoning minimized.";
  }
  return {
    enabled: true,
    thinking: "off",
    model: nextModel,
    swapped: canSwap,
    note,
    tradeoff: FAST_TRADEOFF,
  };
}

/** Render a `/fast status` line. Pure. */
export function renderFastStatus({ enabled, provider, model } = {}) {
  if (!enabled) {
    return "Fast mode: off. /fast on for a low-latency profile.";
  }
  const fast = KNOWN_FAST_MODELS[String(provider).toLowerCase()];
  const modelBit = fast ? ` fast model: ${fast};` : "";
  return `Fast mode: on —${modelBit} reasoning minimized. ${FAST_TRADEOFF}`;
}
