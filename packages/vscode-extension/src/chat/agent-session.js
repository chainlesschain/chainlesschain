/**
 * Long-lived `cc agent` duplex session powering the chat panel.
 *
 * Spawns ONE persistent child:
 *   cc agent --input-format stream-json --output-format stream-json
 *            --include-partial-messages
 * and speaks the CLI's SDK-style protocol over its pipes:
 *   stdin  ← one NDJSON user event per turn   {"type":"user","text":"…"}
 *   stdout → NDJSON events (system/init, stream_event deltas, tool_use,
 *            tool_result, token_usage, result, …) → `onEvent(evt)`
 *
 * The child inherits CHAINLESSCHAIN_IDE_PORT/_TOKEN from the caller's env, so
 * the agent auto-connects back to THIS window's IDE bridge — selection
 * context, diagnostics feedback, and openDiff reviews all light up for free.
 *
 * Pure Node (no `vscode`); `deps.spawn` is injectable so tests drive it with
 * a fake child process.
 */
const { spawn } = require("child_process");

class AgentChatSession {
  /**
   * @param {object} opts
   *   command   cc executable (default "cc"; Windows resolves cc.cmd via shell)
   *   args      extra CLI args appended after the protocol flags
   *   cwd       working directory for the agent (workspace root)
   *   env       environment for the child (include the bridge port/token!)
   *   onEvent   (evt:object) => void       parsed NDJSON event
   *   onStderr  (line:string) => void      raw stderr lines (tool trace, logs)
   *   onExit    ({code,signal}) => void
   *   deps      { spawn? } test seam
   */
  constructor(opts = {}) {
    this.opts = opts;
    this._deps = { spawn, ...(opts.deps || {}) };
    this.child = null;
    this._stdoutBuf = "";
    this._stderrBuf = "";
  }

  get running() {
    return !!this.child && this.child.exitCode == null && !this.child.killed;
  }

  start() {
    if (this.running) return this;
    const command = this.opts.command || "cc";
    const args = [
      "agent",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      ...(this.opts.args || []),
    ];
    this.child = this._deps.spawn(command, args, {
      cwd: this.opts.cwd || process.cwd(),
      env: this.opts.env || process.env,
      stdio: ["pipe", "pipe", "pipe"],
      // npm global shims on Windows are .cmd files — they need a shell.
      shell: process.platform === "win32",
    });
    this._stdoutBuf = "";
    this._stderrBuf = "";
    this.child.stdout.on("data", (chunk) => {
      this._stdoutBuf += chunk.toString("utf8");
      let idx;
      while ((idx = this._stdoutBuf.indexOf("\n")) >= 0) {
        const line = this._stdoutBuf.slice(0, idx).trim();
        this._stdoutBuf = this._stdoutBuf.slice(idx + 1);
        if (!line) continue;
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          evt = { type: "raw", text: line }; // non-JSON stdout, surface as-is
        }
        this._emit(evt);
      }
    });
    this.child.stderr.on("data", (chunk) => {
      this._stderrBuf += chunk.toString("utf8");
      let idx;
      while ((idx = this._stderrBuf.indexOf("\n")) >= 0) {
        const line = this._stderrBuf.slice(0, idx).trimEnd();
        this._stderrBuf = this._stderrBuf.slice(idx + 1);
        if (line && typeof this.opts.onStderr === "function") {
          try {
            this.opts.onStderr(line);
          } catch {
            /* listener errors must not kill the pump */
          }
        }
      }
    });
    this.child.on("close", (code, signal) => {
      const child = this.child;
      this.child = null;
      if (typeof this.opts.onExit === "function") {
        try {
          this.opts.onExit({ code, signal, child });
        } catch {
          /* ignore */
        }
      }
    });
    this.child.on("error", (err) => {
      // spawn failure (cc not installed / not on PATH) — surface as an event
      this._emit({ type: "session_error", error: err.message });
    });
    return this;
  }

  _emit(evt) {
    if (typeof this.opts.onEvent === "function") {
      try {
        this.opts.onEvent(evt);
      } catch {
        /* listener errors must not kill the pump */
      }
    }
  }

  /** Send one user turn. Returns false when the session is not running. */
  send(text) {
    if (!this.running || typeof text !== "string" || !text.trim()) {
      return false;
    }
    try {
      this.child.stdin.write(JSON.stringify({ type: "user", text }) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  /** End the conversation gracefully (close stdin → CLI tears down + exits). */
  end() {
    try {
      this.child?.stdin?.end();
    } catch {
      /* ignore */
    }
  }

  /** Hard stop. */
  stop() {
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = { AgentChatSession };
