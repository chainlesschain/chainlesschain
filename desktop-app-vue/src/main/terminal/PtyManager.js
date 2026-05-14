/**
 * PtyManager — singleton, owns all in-process PTY sessions for the desktop
 * web-shell. Spawned by `web-shell-bootstrap.js` → consumed by
 * `terminal-handlers.js`.
 *
 * Design notes (see docs/design/Android_Remote_Terminal_Plan_A.md §4):
 *
 *   - node-pty is loaded LAZILY via `_deps.loadNodePty()` so the module
 *     can be required in unit tests / on machines without the native
 *     binding without crashing. Real spawn raises a clean error envelope
 *     ("pty_native_unavailable") that surfaces to the SPA.
 *   - Each session keeps its own RingBuffer (256 KiB default, in-memory
 *     only — see RingBuffer doc for rationale).
 *   - `EventEmitter` fans out `stdout` / `exit` events so handlers can
 *     translate them to WS envelopes without coupling to ws-cli-loader.
 *   - Idle kill: 24h default. Idle counter resets on stdin OR stdout.
 *   - Shell whitelist enforced at create-time (config) — unknown shell
 *     returns `shell_not_allowed`.
 *   - Dangerous-keyword stdin gating is NOT here; it's in
 *     terminal-handlers (which owns user-facing confirm UI). This class
 *     only owns the PTY mechanics.
 */

const EventEmitter = require("events");
const { randomUUID } = require("crypto");
const { RingBuffer } = require("./RingBuffer");

const DEFAULT_CONFIG = Object.freeze({
  shellWhitelist: ["pwsh", "cmd", "bash", "wsl"],
  defaultShell: process.platform === "win32" ? "pwsh" : "bash",
  defaultCwd: null, // null → process.cwd()
  maxConcurrentSessions: 8,
  ringBufferBytes: 256 * 1024,
  idleKillMs: 24 * 60 * 60 * 1000,
});

// Map whitelisted shell name → resolved executable + args. node-pty needs a
// real path / command name to spawn. Login-shell flags ensure ~/.bashrc /
// ~/.profile load so user PATH (npm-global, cargo, brew etc.) is visible —
// otherwise `cc` / `claude` / other globally-installed CLIs are unreachable
// in the remote terminal (real-device E2E feedback, 2026-05-14).
function resolveShellCmd(shell) {
  if (process.platform === "win32") {
    if (shell === "cmd") {
      return { cmd: process.env.ComSpec || "cmd.exe", args: [] };
    }
    if (shell === "pwsh") {
      // pwsh auto-loads $PROFILE unless -NoProfile is passed; Windows PATH
      // already contains npm-global so cc/claude work out of the box.
      return { cmd: "pwsh.exe", args: [] };
    }
    if (shell === "wsl") {
      // wsl.exe with no args picks default distro + default user. To inherit
      // the user's PATH we force bash login shell explicitly.
      return { cmd: "wsl.exe", args: ["--", "bash", "-l"] };
    }
    if (shell === "bash") {
      // git-bash on Windows — -l = login shell, loads ~/.bash_profile.
      // PATH-resolved `bash.exe` often matches WSL's bash first (under
      // C:\Windows\System32\bash.exe), which logs into WSL as root user
      // and bypasses the dev's Windows PATH (node/npm-global → cc/claude
      // unreachable). Probe well-known git-bash install paths first.
      const fs = require("node:fs");
      const candidates = [
        process.env.GIT_BASH, // user override
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        process.env.LOCALAPPDATA
          ? `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`
          : null,
      ].filter(Boolean);
      for (const p of candidates) {
        try {
          if (fs.existsSync(p)) {
            return { cmd: p, args: ["-l"] };
          }
        } catch {
          /* keep probing */
        }
      }
      return { cmd: "bash.exe", args: ["-l"] }; // fallback to PATH
    }
  }
  // posix: pwsh/bash on PATH; -l on bash to load ~/.bashrc
  if (shell === "bash") {
    return { cmd: "bash", args: ["-l"] };
  }
  return { cmd: shell, args: [] };
}

class PtyManager extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {object} [opts.config] override default config
   * @param {object} [opts._deps] DI for unit tests
   * @param {() => any} [opts._deps.loadNodePty] returns node-pty-like module
   *   with `spawn(cmd, args, options)` → ptyProcess { pid, write, resize, kill,
   *   onData(cb), onExit(cb) }
   * @param {() => number} [opts._deps.now] clock for idle/test
   */
  constructor(opts = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
    this._deps = {
      loadNodePty: opts._deps?.loadNodePty || (() => require("node-pty")),
      now: opts._deps?.now || (() => Date.now()),
    };
    /** @type {Map<string, PtySession>} */
    this._sessions = new Map();
    this._idleTimer = null;
    this._stopped = false;
  }

  /**
   * @param {object} req
   * @param {string} [req.shell]
   * @param {string} [req.cwd]
   * @param {Record<string,string>} [req.env]
   * @param {number} [req.cols]
   * @param {number} [req.rows]
   * @returns {{ sessionId: string, pid: number, shell: string, createdAt: number }}
   */
  create(req = {}) {
    if (this._stopped) {
      throw new Error("pty_manager_stopped");
    }
    if (this._sessions.size >= this.config.maxConcurrentSessions) {
      throw new Error("max_concurrent_sessions_exceeded");
    }
    const shell = req.shell || this.config.defaultShell;
    if (!this.config.shellWhitelist.includes(shell)) {
      throw new Error("shell_not_allowed");
    }

    let pty;
    try {
      pty = this._deps.loadNodePty();
    } catch {
      const err = new Error("pty_native_unavailable");
      err.cause = "node-pty failed to load (native binding missing)";
      throw err;
    }

    const cwd = req.cwd || this.config.defaultCwd || process.cwd();
    const cols = Number.isFinite(req.cols) ? req.cols : 80;
    const rows = Number.isFinite(req.rows) ? req.rows : 24;
    const { cmd, args } = resolveShellCmd(shell);

    const proc = pty.spawn(cmd, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: { ...process.env, ...(req.env || {}) },
    });

    const sessionId = randomUUID();
    const session = new PtySession({
      id: sessionId,
      shell,
      cwd,
      cols,
      rows,
      proc,
      createdAt: this._deps.now(),
      ringBuffer: new RingBuffer({ maxBytes: this.config.ringBufferBytes }),
    });
    this._sessions.set(sessionId, session);

    proc.onData((data) => {
      const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
      const seq = session.ringBuffer.push(buf);
      session.lastActivityAt = this._deps.now();
      this.emit("stdout", {
        sessionId,
        data: buf,
        seq,
      });
    });

    proc.onExit(({ exitCode, signal }) => {
      session.alive = false;
      session.exitCode = exitCode ?? null;
      session.signal = signal ?? null;
      this.emit("exit", {
        sessionId,
        exitCode: session.exitCode,
        signal: session.signal,
      });
      // Retain session for 60s so reconnecting clients can pull the tail
      // via `terminal.history` before the manager evicts it.
      setTimeout(() => {
        if (this._sessions.get(sessionId) === session) {
          this._sessions.delete(sessionId);
        }
      }, 60 * 1000).unref?.();
    });

    this._ensureIdleSweeper();

    return {
      sessionId,
      pid: proc.pid,
      shell,
      createdAt: session.createdAt,
    };
  }

  /**
   * @param {string} sessionId
   * @param {Buffer | string} data
   */
  write(sessionId, data) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    if (!session.alive) {
      throw new Error("session_not_alive");
    }
    const str = Buffer.isBuffer(data) ? data.toString("utf-8") : data;
    session.proc.write(str);
    session.lastActivityAt = this._deps.now();
  }

  /**
   * @param {string} sessionId
   * @param {number} cols
   * @param {number} rows
   */
  resize(sessionId, cols, rows) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    if (!session.alive) {
      throw new Error("session_not_alive");
    }
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
      throw new Error("invalid_dimensions");
    }
    session.proc.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }

  /**
   * @param {string} sessionId
   */
  close(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    if (session.alive) {
      try {
        session.proc.kill();
      } catch {
        // Ignore — onExit handler will mark it dead.
      }
    }
  }

  /**
   * @returns {Array<{ id: string, shell: string, cwd: string, createdAt: number, alive: boolean, lastSeq: number }>}
   */
  list() {
    const out = [];
    for (const s of this._sessions.values()) {
      out.push({
        id: s.id,
        shell: s.shell,
        cwd: s.cwd,
        createdAt: s.createdAt,
        alive: s.alive,
        lastSeq: s.ringBuffer.lastSeq,
      });
    }
    return out;
  }

  /**
   * @param {string} sessionId
   * @param {number} [fromSeq]
   */
  history(sessionId, fromSeq = 0) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    return session.ringBuffer.since(fromSeq);
  }

  _ensureIdleSweeper() {
    if (this._idleTimer) {
      return;
    }
    // Sweep hourly; cheap loop, only acts on truly idle sessions.
    this._idleTimer = setInterval(() => this._sweepIdle(), 60 * 60 * 1000);
    this._idleTimer.unref?.();
  }

  _sweepIdle() {
    const now = this._deps.now();
    for (const session of this._sessions.values()) {
      if (!session.alive) {
        continue;
      }
      if (now - session.lastActivityAt > this.config.idleKillMs) {
        try {
          session.proc.kill();
        } catch {
          /* onExit will clean up */
        }
      }
    }
  }

  /**
   * Kill all sessions and stop accepting new ones. Called on app shutdown.
   */
  shutdown() {
    this._stopped = true;
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
    for (const session of this._sessions.values()) {
      if (session.alive) {
        try {
          session.proc.kill();
        } catch {
          /* best effort */
        }
      }
    }
  }

  /**
   * Test-only: number of sessions currently tracked (alive + lingering).
   */
  get _sessionCount() {
    return this._sessions.size;
  }
}

class PtySession {
  constructor({ id, shell, cwd, cols, rows, proc, createdAt, ringBuffer }) {
    this.id = id;
    this.shell = shell;
    this.cwd = cwd;
    this.cols = cols;
    this.rows = rows;
    this.proc = proc;
    this.createdAt = createdAt;
    this.ringBuffer = ringBuffer;
    this.alive = true;
    this.exitCode = null;
    this.signal = null;
    this.lastActivityAt = createdAt;
  }
}

module.exports = { PtyManager, DEFAULT_CONFIG };
