/**
 * Non-blocking, provider-neutral prompt suggestions for the agent REPL.
 *
 * The controller accepts an injected `generate(context, { signal })` callback,
 * so it can use whichever provider/runtime already owns the conversation. A
 * small local heuristic is the no-provider fallback. Scheduling never blocks
 * readline and a newer turn cancels an obsolete generation.
 */

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);
export const MAX_PROMPT_SUGGESTIONS = 3;
export const MAX_SUGGESTION_CHARS = 180;

function boolValue(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

/** Environment override > effective config > default. */
export function resolvePromptSuggestionsEnabled(options = {}) {
  const envValue = boolValue(
    (options.env || process.env).CC_PROMPT_SUGGESTIONS,
  );
  if (envValue !== null) return envValue;
  const config = options.config || {};
  const configured = boolValue(
    config.cli?.promptSuggestions ?? config.features?.promptSuggestions,
  );
  return configured ?? options.defaultEnabled ?? true;
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join(" ");
}

function lastAssistantText(context) {
  if (typeof context?.lastAssistantText === "string") {
    return context.lastAssistantText;
  }
  const messages = Array.isArray(context?.messages) ? context.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return messageText(messages[index]);
    }
  }
  return "";
}

/** Local fallback used when no model-backed generator is supplied. */
export async function deriveLocalPromptSuggestions(context = {}) {
  const text = lastAssistantText(context).toLowerCase();
  const suggestions = [];
  if (/\b(error|failed|failure|exception)\b|失败|报错|异常/.test(text)) {
    suggestions.push("定位刚才失败的根因，修复后重新验证");
  }
  if (/\b(test|tests|tested|coverage)\b|测试|覆盖率/.test(text)) {
    suggestions.push("运行相关测试并汇总仍需处理的问题");
  }
  if (
    /\b(todo|remaining|next step|follow[- ]?up)\b|待办|剩余|下一步/.test(text)
  ) {
    suggestions.push("继续完成尚未处理的下一项，并给出验证结果");
  }
  if (/\b(diff|changed|modified|implementation)\b|变更|修改|实现/.test(text)) {
    suggestions.push("审查最新变更，检查边界情况和回归风险");
  }
  if (!suggestions.length && text.trim()) {
    suggestions.push("基于当前结果继续推进最合适的下一步");
  }
  return suggestions;
}

function splitSuggestionText(value) {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

export function normalizePromptSuggestions(value, options = {}) {
  const input = Array.isArray(value)
    ? value
    : Array.isArray(value?.suggestions)
      ? value.suggestions
      : splitSuggestionText(value);
  const maxItems = Math.max(
    1,
    Number(options.maxItems) || MAX_PROMPT_SUGGESTIONS,
  );
  const maxChars = Math.max(
    20,
    Number(options.maxChars) || MAX_SUGGESTION_CHARS,
  );
  const seen = new Set();
  const result = [];
  for (const item of input) {
    const candidate =
      typeof item === "string"
        ? item
        : typeof item?.prompt === "string"
          ? item.prompt
          : typeof item?.text === "string"
            ? item.text
            : "";
    const text = String(candidate)
      .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const bounded =
      text.length > maxChars
        ? `${text.slice(0, Math.max(1, maxChars - 1))}…`
        : text;
    const identity = bounded.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(bounded);
    if (result.length >= maxItems) break;
  }
  return result;
}

export function renderPromptSuggestions(suggestions) {
  const list = normalizePromptSuggestions(suggestions);
  if (!list.length) return "No prompt suggestions available.";
  return [
    "Suggested next prompts:",
    ...list.map((suggestion, index) => `  ${index + 1}. ${suggestion}`),
  ].join("\n");
}

export class PromptSuggestionController {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.generate = options.generate || deriveLocalPromptSuggestions;
    this.debounceMs = Math.max(0, Number(options.debounceMs) || 0);
    this.onUpdate =
      typeof options.onUpdate === "function" ? options.onUpdate : () => {};
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.latest = [];
    this.error = null;
    this._generation = 0;
    this._active = null;
  }

  _cancelActive(reason = "superseded") {
    const active = this._active;
    if (!active) return;
    if (active.timer != null) this.clearTimer(active.timer);
    active.controller.abort(reason);
    active.resolve({ status: "cancelled", reason, suggestions: [] });
    this._active = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
    if (!this.enabled) {
      this._cancelActive("disabled");
      this.latest = [];
      this.error = null;
    }
    return this.enabled;
  }

  schedule(context = {}) {
    if (!this.enabled) {
      return {
        scheduled: false,
        generation: this._generation,
        promise: Promise.resolve({
          status: "disabled",
          suggestions: [],
        }),
      };
    }
    this._cancelActive();
    const generation = ++this._generation;
    const controller = new AbortController();
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    const active = {
      generation,
      controller,
      resolve: resolvePromise,
      timer: null,
      promise,
    };
    this._active = active;
    active.timer = this.setTimer(async () => {
      active.timer = null;
      try {
        const generated = await this.generate(context, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || this._active !== active) return;
        const suggestions = normalizePromptSuggestions(generated);
        this.latest = suggestions.slice();
        this.error = null;
        this._active = null;
        resolvePromise({ status: "ready", suggestions: suggestions.slice() });
        try {
          this.onUpdate(suggestions.slice(), { generation });
        } catch {
          // Rendering callbacks cannot break suggestion lifecycle state.
        }
      } catch (error) {
        if (controller.signal.aborted || this._active !== active) return;
        this.error = error;
        this._active = null;
        resolvePromise({ status: "failed", error, suggestions: [] });
      }
    }, this.debounceMs);
    return { scheduled: true, generation, promise };
  }

  status() {
    return {
      enabled: this.enabled,
      generating: this._active !== null,
      generation: this._generation,
      suggestions: this.latest.slice(),
      error: this.error ? "generation failed" : null,
    };
  }

  dispose() {
    this._cancelActive("disposed");
  }
}

export function parsePromptSuggestionsCommand(args) {
  const command = String(args || "")
    .trim()
    .toLowerCase();
  if (!command || command === "status") return { action: "status" };
  if (TRUE_VALUES.has(command)) return { action: "set", enabled: true };
  if (FALSE_VALUES.has(command)) return { action: "set", enabled: false };
  if (command === "refresh") return { action: "refresh" };
  return { action: "help" };
}

export function runPromptSuggestionsCommand(args, options = {}) {
  const controller = options.controller;
  if (!controller) throw new Error("prompt suggestion controller is required");
  const parsed = parsePromptSuggestionsCommand(args);
  if (parsed.action === "set") {
    try {
      if (typeof options.persistEnabled === "function") {
        options.persistEnabled(parsed.enabled);
      }
    } catch (error) {
      return {
        ok: false,
        action: "set",
        enabled: controller.status().enabled,
        message: `Could not update prompt suggestions: ${error.message}`,
      };
    }
    controller.setEnabled(parsed.enabled);
    return {
      ok: true,
      action: "set",
      enabled: parsed.enabled,
      message: `Prompt suggestions ${parsed.enabled ? "enabled" : "disabled"}.`,
    };
  }
  if (parsed.action === "refresh") {
    const scheduled = controller.schedule(options.context || {});
    return {
      ok: scheduled.scheduled,
      action: "refresh",
      ...scheduled,
      message: scheduled.scheduled
        ? "Refreshing prompt suggestions in the background."
        : "Prompt suggestions are disabled.",
    };
  }
  if (parsed.action === "status") {
    const status = controller.status();
    return {
      ok: true,
      action: "status",
      ...status,
      message:
        `Prompt suggestions: ${status.enabled ? "on" : "off"}` +
        (status.generating ? " (generating)" : "") +
        (status.suggestions.length
          ? `\n${renderPromptSuggestions(status.suggestions)}`
          : ""),
    };
  }
  return {
    ok: false,
    action: "help",
    message: "Usage: /suggestions on|off|status|refresh",
  };
}
