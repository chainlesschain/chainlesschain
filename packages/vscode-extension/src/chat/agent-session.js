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
const { hardenedEnv } = require("../hardened-env");
// Vendored @chainlesschain/agent-sdk (scripts/sync-agent-sdk.mjs): the
// protocol argv + NDJSON framing are SDK contracts now, not hand-rolled.
const { buildAgentArgs } = require("../vendor/agent-sdk/agent-session.js");
const { createNdjsonDecoder } = require("../vendor/agent-sdk/ndjson.js");

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
    this._decode = null;
    this._stderrBuf = "";
  }

  get running() {
    return !!this.child && this.child.exitCode == null && !this.child.killed;
  }

  start() {
    if (this.running) return this;
    const command = this.opts.command || "cc";
    const args = buildAgentArgs({ extraArgs: this.opts.args || [] });
    this.child = this._deps.spawn(command, args, {
      cwd: this.opts.cwd || process.cwd(),
      // Hardened so cmd.exe doesn't resolve a repo-local `cc.bat` before PATH.
      env: hardenedEnv(this.opts.env),
      stdio: ["pipe", "pipe", "pipe"],
      // npm global shims on Windows are .cmd files — they need a shell.
      shell: process.platform === "win32",
    });
    this._stderrBuf = "";
    // SDK carry-buffer framing: a chunk boundary can split a line. Non-JSON
    // stdout surfaces as {type:"raw"} exactly as before.
    this._decode = createNdjsonDecoder(
      (evt) => this._emit(evt),
      { onError: (_err, line) => {
          if (line) this._emit({ type: "raw", text: line.trim() });
        } },
    );
    this.child.stdout.on("data", (chunk) => {
      this._decode(chunk.toString("utf8"));
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
      // Flush a final unterminated line — error output often lacks the
      // trailing \n and would otherwise be dropped silently.
      try {
        this._decode.flush();
      } catch {
        /* best-effort */
      }
      const errRest = this._stderrBuf.trimEnd();
      this._stderrBuf = "";
      if (errRest && typeof this.opts.onStderr === "function") {
        try {
          this.opts.onStderr(errRest);
        } catch {
          /* listener errors must not kill the pump */
        }
      }
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
    // stdin can emit an ASYNC 'error' (EPIPE) when we write just as the child
    // dies (crash mid-turn, or cc closing stdin) — with no listener it throws
    // uncaught in the extension host. The sync try/catch in sendEvent can't
    // catch it; swallow it here (the "close" handler drives recovery).
    if (this.child.stdin) this.child.stdin.on("error", () => {});
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

  /** Send one raw NDJSON event (user turn / plan control / …). */
  sendEvent(obj) {
    if (!this.running || !obj || typeof obj !== "object") return false;
    try {
      this.child.stdin.write(JSON.stringify(obj) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  /** Send one user turn. Returns false when the session is not running. */
  send(text) {
    if (typeof text !== "string" || !text.trim()) return false;
    return this.sendEvent({ type: "user", text });
  }

  /** End the conversation gracefully (close stdin → CLI tears down + exits). */
  end() {
    try {
      this.child?.stdin?.end();
    } catch {
      /* ignore */
    }
  }

  /**
   * Hard stop — kills the whole process tree. On Windows the child is a
   * cmd.exe wrapper (shell:true for the .cmd shim), so a plain kill() orphans
   * the real cc/node grandchild, which keeps burning tokens and holds the
   * better_sqlite3 lock; taskkill /T reaps it (same pattern as preview.js).
   * On POSIX cc is spawned directly and reaps its own children on SIGTERM.
   */
  stop() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    const pid = child.pid;
    if (pid && process.platform === "win32") {
      try {
        this._deps.spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          windowsHide: true,
        });
        return;
      } catch {
        /* fall through to child.kill */
      }
    }
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

module.exports = { AgentChatSession };
