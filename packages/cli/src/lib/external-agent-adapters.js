/**
 * Provider-specific contracts for non-interactive coding-agent CLIs.
 *
 * Keep argv construction and JSONL parsing here instead of assuming that two
 * CLIs with similar product goals expose the same wire protocol.
 */

export const EXTERNAL_AGENT_PROTOCOL = Object.freeze({
  CLAUDE_STREAM_JSON: "claude-stream-json-v1",
  CODEX_EXEC_JSONL: "codex-exec-jsonl-v1",
});

export const EXTERNAL_AGENT_ERROR = Object.freeze({
  CANCELLED: "EXTERNAL_AGENT_CANCELLED",
  TIMEOUT: "EXTERNAL_AGENT_TIMEOUT",
  EXIT_NONZERO: "EXTERNAL_AGENT_EXIT_NONZERO",
  SPAWN_FAILED: "EXTERNAL_AGENT_SPAWN_FAILED",
  PROTOCOL_FAILED: "EXTERNAL_AGENT_PROTOCOL_FAILED",
  UNSUPPORTED_OPTION: "EXTERNAL_AGENT_UNSUPPORTED_OPTION",
});

const KNOWN_CODEX_ITEM_TYPES = new Set([
  "agent_message",
  "reasoning",
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
  "plan_update",
]);

function stringifyValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function errorMessage(value, fallback) {
  if (typeof value === "string" && value) return value;
  if (value && typeof value.message === "string" && value.message) {
    return value.message;
  }
  return fallback;
}

/**
 * Common adapter surface. Subclasses provide buildArgs() and parseEvent().
 */
export class ExternalAgentAdapter {
  constructor(options = {}) {
    this.command = options.command;
    this.model = options.model || null;
  }

  capabilities() {
    return Object.freeze({
      protocol: "unknown",
      jsonl: false,
      modelOverride: false,
      allowedTools: false,
      requiresTerminalEvent: false,
    });
  }

  buildArgs() {
    throw new Error("ExternalAgentAdapter.buildArgs() must be implemented");
  }

  parseEvent() {
    throw new Error("ExternalAgentAdapter.parseEvent() must be implemented");
  }

  /**
   * Reduce a JSONL transcript into a provider-neutral terminal projection.
   * Unknown additive events are retained for diagnostics but do not make a
   * successful run fail.
   */
  parseTranscript(raw) {
    const lines = String(raw || "")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const projection = {
      output: "",
      terminal: null,
      error: null,
      parsedEventCount: 0,
      malformedLineCount: 0,
      unknownEventTypes: [],
      unknownItemTypes: [],
      usage: null,
    };
    const unknownEvents = new Set();
    const unknownItems = new Set();

    for (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
        projection.parsedEventCount += 1;
      } catch (_err) {
        projection.malformedLineCount += 1;
        continue;
      }

      const normalized = this.parseEvent(event);
      if (normalized.output) projection.output = normalized.output;
      if (normalized.terminal) projection.terminal = normalized.terminal;
      if (normalized.error) projection.error = normalized.error;
      if (normalized.usage) projection.usage = normalized.usage;
      if (normalized.unknownEventType) {
        unknownEvents.add(normalized.unknownEventType);
      }
      if (normalized.unknownItemType) {
        unknownItems.add(normalized.unknownItemType);
      }
    }

    projection.unknownEventTypes = [...unknownEvents];
    projection.unknownItemTypes = [...unknownItems];
    return projection;
  }
}

export class ClaudeAdapter extends ExternalAgentAdapter {
  constructor(options = {}) {
    super({ ...options, command: options.command || "claude" });
  }

  capabilities() {
    return Object.freeze({
      protocol: EXTERNAL_AGENT_PROTOCOL.CLAUDE_STREAM_JSON,
      jsonl: true,
      modelOverride: true,
      allowedTools: true,
      requiresTerminalEvent: true,
    });
  }

  buildArgs({ prompt, allowedTools = null } = {}) {
    const args = ["-p", String(prompt || ""), "--output-format", "stream-json"];
    if (this.model) args.push("--model", this.model);
    if (allowedTools) args.push("--allowedTools", allowedTools);
    return args;
  }

  parseEvent(event) {
    if (!event || typeof event !== "object") {
      return { unknownEventType: "<non-object>" };
    }

    if (event.type === "result") {
      const failed = event.is_error === true || event.subtype === "error";
      return {
        output: event.result ? stringifyValue(event.result) : "",
        terminal: failed ? "failed" : "completed",
        error: failed
          ? errorMessage(event.error || event.result, "Claude Code turn failed")
          : null,
        usage: event.usage || null,
      };
    }

    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      const output = event.message.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .filter(Boolean)
        .join("\n");
      return { output };
    }

    // These are progress/input events in Claude Code stream-json.
    if (["system", "user", "rate_limit_event"].includes(event.type)) {
      return {};
    }
    return { unknownEventType: String(event.type || "<missing>") };
  }
}

export class CodexAdapter extends ExternalAgentAdapter {
  constructor(options = {}) {
    super({ ...options, command: options.command || "codex" });
    this.sandbox = options.sandbox || null;
  }

  capabilities() {
    return Object.freeze({
      protocol: EXTERNAL_AGENT_PROTOCOL.CODEX_EXEC_JSONL,
      jsonl: true,
      modelOverride: true,
      allowedTools: false,
      requiresTerminalEvent: true,
      sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
    });
  }

  buildArgs({ prompt, allowedTools = null } = {}) {
    if (allowedTools) {
      const err = new Error(
        "Codex CLI does not expose Claude Code's --allowedTools option",
      );
      err.code = EXTERNAL_AGENT_ERROR.UNSUPPORTED_OPTION;
      throw err;
    }

    const args = ["exec", "--json"];
    if (this.model) args.push("--model", this.model);
    if (this.sandbox) args.push("--sandbox", this.sandbox);
    args.push(String(prompt || ""));
    return args;
  }

  parseEvent(event) {
    if (!event || typeof event !== "object") {
      return { unknownEventType: "<non-object>" };
    }

    switch (event.type) {
      case "thread.started":
      case "turn.started":
        return {};
      case "turn.completed":
        return {
          terminal: "completed",
          usage: event.usage || null,
        };
      case "turn.failed":
        return {
          terminal: "failed",
          error: errorMessage(event.error, "Codex turn failed"),
        };
      case "error":
        return {
          terminal: "failed",
          error: errorMessage(event.error || event, "Codex emitted an error"),
        };
      case "item.started":
      case "item.updated":
      case "item.completed": {
        const itemType = event.item?.type;
        const unknownItemType =
          itemType && !KNOWN_CODEX_ITEM_TYPES.has(itemType)
            ? String(itemType)
            : null;
        const output =
          event.type === "item.completed" &&
          itemType === "agent_message" &&
          typeof event.item?.text === "string"
            ? event.item.text
            : "";
        return { output, unknownItemType };
      }
      default:
        return { unknownEventType: String(event.type || "<missing>") };
    }
  }
}

export function createExternalAgentAdapter(options = {}) {
  const command = options.command || options.cliCommand || "claude";
  if (command === "codex" || /(^|[\\/])codex(?:\.cmd|\.exe)?$/i.test(command)) {
    return new CodexAdapter({ ...options, command });
  }
  if (
    command === "claude" ||
    /(^|[\\/])claude(?:\.cmd|\.exe)?$/i.test(command)
  ) {
    return new ClaudeAdapter({ ...options, command });
  }
  throw new Error(`Unsupported external agent CLI: ${command}`);
}
