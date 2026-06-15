/**
 * Pure capture buffer for terminal shell executions (Claude-Code parity:
 * "include terminal output in prompts"). The facade subscribes to VS Code's
 * shell-integration events and feeds each finished command + its output here;
 * the `getTerminalOutput` IDE tool reads recent entries back so the agent can
 * see what you just ran (and how it failed). No `vscode` — a ring buffer with
 * per-output and entry caps — so it's fully unit-testable.
 */

const DEFAULT_MAX_ENTRIES = 10;
const DEFAULT_MAX_OUTPUT = 8000; // chars per command's output (tail kept)

class TerminalCapture {
  constructor(opts = {}) {
    this._max = opts.maxEntries > 0 ? opts.maxEntries : DEFAULT_MAX_ENTRIES;
    this._maxOutput = opts.maxOutput > 0 ? opts.maxOutput : DEFAULT_MAX_OUTPUT;
    this._entries = [];
  }

  /**
   * Record one finished shell execution. Output is capped to the most recent
   * `maxOutput` chars (errors live at the end); the buffer keeps the last
   * `maxEntries`. Ignores entries without a string command.
   */
  record(e) {
    if (!e || typeof e.command !== "string") return;
    let output = typeof e.output === "string" ? e.output : "";
    let truncated = false;
    if (output.length > this._maxOutput) {
      output = output.slice(-this._maxOutput);
      truncated = true;
    }
    this._entries.push({
      command: e.command,
      exitCode: typeof e.exitCode === "number" ? e.exitCode : null,
      output,
      outputTruncated: truncated,
      terminal: typeof e.terminal === "string" ? e.terminal : "",
      endedAt: Number.isFinite(e.endedAt) ? e.endedAt : null,
    });
    if (this._entries.length > this._max) {
      this._entries.splice(0, this._entries.length - this._max);
    }
  }

  /** The last `limit` entries (default: all), oldest→newest. */
  recent(limit) {
    const n = limit > 0 ? Math.min(limit, this._entries.length) : this._entries.length;
    return this._entries.slice(this._entries.length - n);
  }

  clear() {
    this._entries = [];
  }

  size() {
    return this._entries.length;
  }
}

/** Render recent terminal executions as a compact tagged block, or null. */
function formatTerminalOutput(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const blocks = entries.map((e) => {
    const code = e.exitCode == null ? "" : ` (exit ${e.exitCode})`;
    const term = e.terminal ? ` [${e.terminal}]` : "";
    const out =
      e.output && e.output.length ? e.output : "(no captured output)";
    const trunc = e.outputTruncated ? "\n…(output truncated)" : "";
    return `$ ${e.command}${code}${term}\n${out}${trunc}`;
  });
  return blocks.join("\n\n");
}

module.exports = {
  TerminalCapture,
  formatTerminalOutput,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_OUTPUT,
};
