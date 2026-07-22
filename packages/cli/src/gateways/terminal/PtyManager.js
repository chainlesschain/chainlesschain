/**
 * PtyManager — ESM mirror of `desktop-app-vue/src/main/terminal/PtyManager.js`.
 *
 * Keep both copies in sync. The desktop copy targets Electron's CJS main
 * process; this one targets `cc ui` (Node ESM) so `cc ui` users also get
 * remote-terminal support via the same WS protocol.
 *
 * Design notes — see docs/design/Android_Remote_Terminal_Plan_A.md §4:
 *   - node-pty loaded lazily so the module loads without the native
 *     binding installed (tests, headless CI, machines without it).
 *   - Per-session RingBuffer (256 KiB default, memory-only — no disk
 *     persistence: terminal stdout often contains secrets).
 *   - EventEmitter fans out `stdout` / `exit` so handlers translate to
 *     WS envelopes without coupling.
 *   - Idle kill default 24h, resets on stdin OR stdout activity.
 *   - Shell whitelist enforced at create() — unknown shell → throws
 *     `shell_not_allowed`.
 */

import EventEmitter from "events";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import { RingBuffer } from "./RingBuffer.js";
import { executionBroker } from "../../lib/process-execution-broker/index.js";

const require = createRequire(import.meta.url);

export const DEFAULT_CONFIG = Object.freeze({
  shellWhitelist: ["pwsh", "cmd", "bash", "wsl"],
  defaultShell: process.platform === "win32" ? "pwsh" : "bash",
  defaultCwd: null,
  maxConcurrentSessions: 8,
  ringBufferBytes: 256 * 1024,
  idleKillMs: 24 * 60 * 60 * 1000,
});

function resolveShellCmd(shell) {
  if (process.platform === "win32") {
    if (shell === "cmd") return process.env.ComSpec || "cmd.exe";
    if (shell === "pwsh") return "pwsh.exe";
    if (shell === "wsl") return "wsl.exe";
    if (shell === "bash") return "bash.exe";
  }
  return shell;
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

export class PtyManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
    this._deps = {
      loadNodePty: opts._deps?.loadNodePty || (() => require("node-pty")),
      spawnPty: opts._deps?.spawnPty || null,
      now: opts._deps?.now || (() => Date.now()),
    };
    this._sessions = new Map();
    this._idleTimer = null;
    this._stopped = false;
  }

  create(req = {}) {
    if (this._stopped) throw new Error("pty_manager_stopped");
    // Count only LIVE sessions against the cap. A just-exited session lingers
    // in _sessions for ~60s before the reaper removes it (see onExit), so
    // counting `_sessions.size` would spuriously reject new sessions right
    // after a client closes shells — painful over a reconnecting Android link
    // where open/close churn is normal.
    let aliveCount = 0;
    for (const s of this._sessions.values()) if (s.alive) aliveCount++;
    if (aliveCount >= this.config.maxConcurrentSessions) {
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
    const cmd = resolveShellCmd(shell);

    // req.env arrives from a remote WS frame; only merge a plain object, else a
    // string/array would spread into garbage numeric env keys.
    const extraEnv =
      req.env && typeof req.env === "object" && !Array.isArray(req.env)
        ? req.env
        : {};
    const spawnPty = this._deps.spawnPty || executionBroker.spawnPty.bind(executionBroker);
    const proc = spawnPty(pty, cmd, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: { ...process.env, ...extraEnv },
      origin: "terminal:pty",
      policy: "allow",
      scope: "terminal",
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
      this.emit("stdout", { sessionId, data: buf, seq });
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

  write(sessionId, data) {
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error("session_not_found");
    if (!session.alive) throw new Error("session_not_alive");
    const str = Buffer.isBuffer(data) ? data.toString("utf-8") : data;
    session.proc.write(str);
    session.lastActivityAt = this._deps.now();
  }

  resize(sessionId, cols, rows) {
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error("session_not_found");
    if (!session.alive) throw new Error("session_not_alive");
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
      throw new Error("invalid_dimensions");
    }
    session.proc.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }

  close(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error("session_not_found");
    if (session.alive) {
      try {
        session.proc.kill();
      } catch {
        /* onExit will mark dead */
      }
    }
  }

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

  history(sessionId, fromSeq = 0) {
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error("session_not_found");
    return session.ringBuffer.since(fromSeq);
  }

  _ensureIdleSweeper() {
    if (this._idleTimer) return;
    this._idleTimer = setInterval(() => this._sweepIdle(), 60 * 60 * 1000);
    this._idleTimer.unref?.();
  }

  _sweepIdle() {
    const now = this._deps.now();
    for (const session of this._sessions.values()) {
      if (!session.alive) continue;
      if (now - session.lastActivityAt > this.config.idleKillMs) {
        try {
          session.proc.kill();
        } catch {
          /* onExit will clean up */
        }
      }
    }
  }

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

  get _sessionCount() {
    return this._sessions.size;
  }
}
