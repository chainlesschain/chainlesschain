/**
 * SidecarSupervisor — manages the forensics-bridge Python sidecar lifecycle.
 *
 * Protocol: docs/design/Personal_Data_Hub_Python_Sidecar.md §3 (JSON-lines).
 * Counterpart: packages/personal-data-hub-bridge/forensics_bridge/ipc_server.py.
 *
 * Responsibilities:
 *   - Spawn / health-check / restart the sidecar subprocess
 *   - Frame stdin/stdout as JSON-lines (one envelope per line)
 *   - Correlate request id → pending promise; route progress/chunk callbacks
 *   - Forward stderr logs as events for hub audit logging
 *
 * Non-goals (this layer):
 *   - Persisting credentials (caller passes them per-invoke)
 *   - Audit logging (caller subscribes to "log" events)
 *   - Schema validation of params (Python side enforces)
 */

"use strict";

const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const readline = require("node:readline");

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTHCHECK_INTERVAL_MS = 30_000;
const STOP_GRACE_MS = 5_000;

class SidecarTimeoutError extends Error {
  constructor(method, timeoutMs) {
    super(`sidecar method '${method}' timed out after ${timeoutMs}ms`);
    this.name = "SidecarTimeoutError";
    this.code = "TIMEOUT";
    this.retryable = true;
  }
}

class SidecarMethodError extends Error {
  constructor({ code, msg, retryable }) {
    super(msg || code);
    this.name = "SidecarMethodError";
    this.code = code;
    this.retryable = Boolean(retryable);
  }
}

class SidecarNotRunningError extends Error {
  constructor(method) {
    super(`sidecar is not running; cannot invoke '${method}'`);
    this.name = "SidecarNotRunningError";
    this.code = "SIDECAR_NOT_RUNNING";
    this.retryable = true;
  }
}

class SidecarSupervisor extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string|string[]} opts.command - Executable (string) or [exec, ...args] for spawn.
   * @param {string[]} [opts.args] - Extra args appended after `command`.
   * @param {string} [opts.cwd] - Working directory for the child.
   * @param {object} [opts.env] - Env vars merged over process.env.
   * @param {number} [opts.healthCheckIntervalMs] - 0 to disable.
   * @param {number} [opts.defaultTimeoutMs] - Per-invoke default.
   */
  constructor(opts) {
    super();
    if (!opts || !opts.command) {
      throw new Error("SidecarSupervisor requires opts.command");
    }
    const [first, ...rest] = Array.isArray(opts.command)
      ? opts.command
      : [opts.command];
    this._exec = first;
    this._args = [...rest, ...(opts.args || [])];
    this._cwd = opts.cwd;
    this._env = opts.env;
    this._healthCheckIntervalMs =
      opts.healthCheckIntervalMs ?? DEFAULT_HEALTHCHECK_INTERVAL_MS;
    this._defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    this._proc = null;
    this._stdoutReader = null;
    this._stderrReader = null;
    this._pending = new Map(); // id → { resolve, reject, timer, onProgress, onChunk, method }
    this._healthTimer = null;
    this._stopping = false;
  }

  /**
   * Spawn the sidecar and verify it responds to sidecar.ping.
   * Idempotent — calling start() twice returns the same ready promise.
   */
  async start({ readyTimeoutMs = 5_000 } = {}) {
    if (this._proc && !this._proc.killed) {
      return; // already running
    }

    const env = {
      ...process.env,
      ...(this._env || {}),
      PYTHONIOENCODING: "utf-8",
      PYTHONUNBUFFERED: "1",
    };

    this._proc = spawn(this._exec, this._args, {
      cwd: this._cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this._stopping = false;
    this._wireStreams();

    this._proc.on("error", (err) => {
      this.emit("error", err);
      this._failAllPending(err);
    });

    this._proc.on("exit", (code, signal) => {
      this.emit("exit", { code, signal });
      const reason = new Error(
        `sidecar exited (code=${code} signal=${signal})`,
      );
      this._failAllPending(reason);
      this._teardown();
    });

    await this.invoke("sidecar.ping", {}, { timeoutMs: readyTimeoutMs });
    this._scheduleHealthCheck();
  }

  /**
   * Invoke a sidecar method.
   *
   * @param {string} method
   * @param {object} params
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]
   * @param {(data: object) => void} [opts.onProgress] - invoked on progress envelopes
   * @param {(data: object) => void} [opts.onChunk]    - invoked on chunk envelopes
   * @returns {Promise<object>} resolves with the final `result.data`
   */
  invoke(method, params = {}, opts = {}) {
    if (!this._proc || this._proc.killed || this._stopping) {
      return Promise.reject(new SidecarNotRunningError(method));
    }
    const timeoutMs = opts.timeoutMs ?? this._defaultTimeoutMs;
    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        // Best-effort cancel on the sidecar side; don't await the response.
        this._writeLine({
          id: `cancel-${id}`,
          method: "request.cancel",
          params: { id },
        }).catch(() => {});
        reject(new SidecarTimeoutError(method, timeoutMs));
      }, timeoutMs);
      // Allow the process to exit even if a sidecar invocation timer is pending.
      if (typeof timer.unref === "function") timer.unref();

      this._pending.set(id, {
        resolve,
        reject,
        timer,
        onProgress: opts.onProgress,
        onChunk: opts.onChunk,
        method,
      });

      const envelope = { id, method, params, timeout_ms: timeoutMs };
      this._writeLine(envelope).catch((err) => {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Stop the sidecar: SIGTERM → wait grace → SIGKILL.
   * Pending invocations reject with SidecarNotRunningError.
   */
  async stop({ graceMs = STOP_GRACE_MS } = {}) {
    if (!this._proc || this._proc.killed) {
      this._teardown();
      return;
    }
    this._stopping = true;
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
    const proc = this._proc;
    const exited = new Promise((res) => proc.once("exit", res));
    try {
      proc.stdin?.end();
    } catch (_err) {
      /* already closed */
    }
    proc.kill("SIGTERM");
    const killed = await Promise.race([
      exited.then(() => true),
      new Promise((res) => {
        const t = setTimeout(() => res(false), graceMs);
        if (typeof t.unref === "function") t.unref();
      }),
    ]);
    if (!killed) {
      proc.kill("SIGKILL");
      await exited;
    }
    this._teardown();
  }

  isRunning() {
    return Boolean(this._proc) && !this._proc.killed && !this._stopping;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  _wireStreams() {
    this._stdoutReader = readline.createInterface({
      input: this._proc.stdout,
      crlfDelay: Infinity,
    });
    this._stdoutReader.on("line", (line) => {
      if (!line) return;
      let envelope;
      try {
        envelope = JSON.parse(line);
      } catch (err) {
        this.emit("error", new Error(`invalid envelope from sidecar: ${line}`));
        return;
      }
      this._handleEnvelope(envelope);
    });

    this._stderrReader = readline.createInterface({
      input: this._proc.stderr,
      crlfDelay: Infinity,
    });
    this._stderrReader.on("line", (line) => {
      if (!line) return;
      // Sidecar logs pino-style JSON; pass through for hub audit.
      this.emit("log", line);
    });
  }

  _handleEnvelope(env) {
    // Envelopes with no id (e.g. INVALID_JSON parse failures) surface as events.
    if (env.id === null || env.id === undefined) {
      this.emit("orphan", env);
      return;
    }
    const pending = this._pending.get(env.id);
    if (!pending) {
      this.emit("orphan", env);
      return;
    }

    if (env.type === "progress") {
      try {
        pending.onProgress?.(env.data);
      } catch (err) {
        this.emit("error", err);
      }
      return;
    }
    if (env.type === "chunk") {
      try {
        pending.onChunk?.(env.data);
      } catch (err) {
        this.emit("error", err);
      }
      return;
    }
    // Terminal frames remove the pending entry.
    clearTimeout(pending.timer);
    this._pending.delete(env.id);

    if (env.type === "result") {
      pending.resolve(env.data);
    } else if (env.type === "error") {
      pending.reject(new SidecarMethodError(env.error || { code: "UNKNOWN" }));
    } else {
      pending.reject(
        new SidecarMethodError({
          code: "UNKNOWN_ENVELOPE_TYPE",
          msg: `unexpected envelope type: ${env.type}`,
        }),
      );
    }
  }

  _writeLine(envelope) {
    return new Promise((resolve, reject) => {
      if (!this._proc || !this._proc.stdin || this._proc.stdin.destroyed) {
        reject(new SidecarNotRunningError(envelope.method || "<unknown>"));
        return;
      }
      const line = JSON.stringify(envelope) + "\n";
      this._proc.stdin.write(line, "utf8", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  _scheduleHealthCheck() {
    if (!this._healthCheckIntervalMs) return;
    if (this._healthTimer) clearInterval(this._healthTimer);
    this._healthTimer = setInterval(() => {
      this.invoke("sidecar.ping", {}, { timeoutMs: 3_000 }).catch((err) => {
        this.emit("healthCheckFailed", err);
      });
    }, this._healthCheckIntervalMs);
    if (typeof this._healthTimer.unref === "function") {
      this._healthTimer.unref();
    }
  }

  _failAllPending(err) {
    for (const [, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this._pending.clear();
  }

  _teardown() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
    this._stdoutReader?.close();
    this._stderrReader?.close();
    this._stdoutReader = null;
    this._stderrReader = null;
    this._proc = null;
  }
}

module.exports = {
  SidecarSupervisor,
  SidecarTimeoutError,
  SidecarMethodError,
  SidecarNotRunningError,
};
