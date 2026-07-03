"use strict";

/**
 * async-hook-supervisor — run `async: true` settings hooks FIRE-AND-FORGET so a
 * long-running hook (a test suite, a log scan, an external status probe) never
 * blocks the agent's tool chain. The sync path (hook-runner.cjs `runHooks`) uses
 * `spawnSync` and gates the turn; this path uses `spawn` and returns
 * immediately, collecting each hook's result in the background.
 *
 * Two consumption modes on the collected results:
 *   - drainResults()  → every completed hook since the last drain, injected into
 *                       the NEXT turn's additionalContext (like the monitor
 *                       supervisor). Cleared on read.
 *   - drainRewakes()  → the subset whose hook set `asyncRewake: true` AND that
 *                       finished in a FAILURE state (non-zero / blocked /
 *                       timed-out). A pending rewake is the signal to proactively
 *                       re-engage the agent with the structured error, rather
 *                       than waiting for the user's next prompt.
 *
 * Guardrails (parity with PluginMonitorSupervisor, and the Phase 6 acceptance
 * "高频文件写入不会造成无限 Hook 并发"):
 *   - per-(event+command) dedupe while a prior run of the same hook is still in
 *     flight — a rapid PostToolUse hook can't stack N copies of itself;
 *   - a maxConcurrent cap — overflow is DROPPED with a recorded skip, never
 *     queued unbounded;
 *   - a per-hook timeout that kills the child;
 *   - reaping of every child on stopAll() / process 'exit', so a session never
 *     leaves an orphan hook process.
 *
 * `_deps.spawn` / `_deps.now` are injected so the whole supervisor is unit-
 * testable with fake child processes (no real shell).
 */

const cpDefault = require("node:child_process");
const { tryParseDecision } = require("./hook-runner.cjs");

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const DEFAULT_MAX_CONCURRENT = 4;

class AsyncHookSupervisor {
  constructor(opts = {}) {
    this.maxConcurrent =
      Number(opts.maxConcurrent) > 0
        ? Number(opts.maxConcurrent)
        : DEFAULT_MAX_CONCURRENT;
    this._deps = {
      spawn: opts.spawn || cpDefault.spawn,
      now: opts.now || (() => Date.now()),
    };
    this._running = new Map(); // key -> { child, timer }
    this._results = []; // completed records awaiting drainResults()
    this._rewakes = []; // failed asyncRewake records awaiting drainRewakes()
    this._stopped = false;
    this._exitHook = () => this.stopAll();
    process.once("exit", this._exitHook);
  }

  _key(hook) {
    return `${hook.event || ""}::${hook.command}`;
  }

  /**
   * Dispatch a batch of async hooks fire-and-forget. Returns IMMEDIATELY with a
   * per-hook disposition (`{command, dispatched, reason?}`) — it never awaits a
   * hook. `payload` is JSON-written to each hook's stdin (same protocol as the
   * sync runner).
   *
   * @param {Array<{command:string, event?:string, timeout?:number,
   *                asyncRewake?:boolean}>} hooks
   * @param {object} payload   the hook event payload (hook_event_name, …)
   * @param {object} [opts]    { cwd, timeout }  (per-hook timeout wins)
   */
  dispatch(hooks, payload = {}, opts = {}) {
    const dispositions = [];
    for (const hook of hooks || []) {
      if (!hook || !hook.command) continue;
      if (this._stopped) {
        dispositions.push({
          command: hook.command,
          dispatched: false,
          reason: "supervisor stopped",
        });
        continue;
      }
      const key = this._key(hook);
      if (this._running.has(key)) {
        dispositions.push({
          command: hook.command,
          dispatched: false,
          reason: "already running (deduped)",
        });
        continue;
      }
      if (this._running.size >= this.maxConcurrent) {
        dispositions.push({
          command: hook.command,
          dispatched: false,
          reason: "max concurrent reached",
        });
        // Record the skip so the caller/agent can SEE that a hook was dropped
        // (silent truncation would read as "the hook ran and said nothing").
        this._results.push({
          command: hook.command,
          event: hook.event || null,
          ok: false,
          skipped: true,
          exitCode: null,
          error: "async hook skipped: max concurrent reached",
          additionalContext: null,
          blocked: false,
          ts: this._deps.now(),
          ms: 0,
        });
        continue;
      }
      this._spawnOne(hook, payload, opts);
      dispositions.push({ command: hook.command, dispatched: true });
    }
    return dispositions;
  }

  _spawnOne(hook, payload, opts) {
    const key = this._key(hook);
    const started = this._deps.now();
    const rawTimeout = Number(
      hook.timeout != null ? hook.timeout * 1000 : opts.timeout,
    );
    const timeout =
      Number.isFinite(rawTimeout) && rawTimeout > 0
        ? Math.min(rawTimeout, MAX_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;

    let child;
    try {
      child = this._deps.spawn(hook.command, {
        cwd: opts.cwd || process.cwd(),
        shell: true,
        env: {
          ...process.env,
          CLAUDE_HOOK_EVENT: hook.event || payload.hook_event_name || "",
        },
      });
    } catch (err) {
      this._record(hook, {
        ok: false,
        exitCode: null,
        error: `hook spawn failed: ${err.message}`,
        started,
      });
      return;
    }

    let out = "";
    let errOut = "";
    let killedByTimeout = false;
    const rec = { child, timer: null };
    this._running.set(key, rec);

    try {
      child.stdin?.end(JSON.stringify(payload));
    } catch {
      /* stdin may already be closed — non-fatal */
    }
    child.stdout?.on("data", (d) => {
      out += d.toString("utf8");
    });
    child.stderr?.on("data", (d) => {
      errOut += d.toString("utf8");
    });

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }, timeout);
    if (typeof timer.unref === "function") timer.unref();
    rec.timer = timer;

    let settled = false;
    const finalize = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this._running.delete(key);
      const parsed = tryParseDecision(out);
      const blocked = !!(parsed && parsed.decision === "block");
      const ok = !killedByTimeout && exitCode === 0 && !blocked;
      const additionalContext =
        (parsed && parsed.additionalContext) ||
        (exitCode === 0 && out.trim() && out.trim()[0] !== "{"
          ? out.trim()
          : null);
      this._record(hook, {
        ok,
        exitCode,
        started,
        blocked,
        additionalContext,
        error: killedByTimeout
          ? `timed out after ${timeout}ms`
          : ok
            ? null
            : errOut.trim() ||
              (blocked
                ? parsed.reason || "hook requested block"
                : `hook exited ${exitCode}`),
      });
    };

    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this._running.delete(key);
      this._record(hook, {
        ok: false,
        exitCode: null,
        error: `hook error: ${e.message}`,
        started,
      });
    });
    child.on("close", (code) => finalize(code));
  }

  _record(hook, fields) {
    const now = this._deps.now();
    const rec = {
      command: hook.command,
      event: hook.event || null,
      ok: fields.ok === true,
      exitCode: fields.exitCode ?? null,
      error: fields.error || null,
      additionalContext: fields.additionalContext || null,
      blocked: !!fields.blocked,
      ts: now,
      ms: fields.started != null ? now - fields.started : 0,
    };
    this._results.push(rec);
    // A rewake fires only for a hook that OPTED IN and finished in a failure
    // state — a passing async check should not re-engage the agent.
    if (hook.asyncRewake && !rec.ok) {
      this._rewakes.push(rec);
    }
  }

  /** Completed result records since the last drain (cleared on read). */
  drainResults() {
    const r = this._results;
    this._results = [];
    return r;
  }

  peekResults() {
    return this._results.slice();
  }

  /** Failed asyncRewake records since the last drain (cleared on read). */
  drainRewakes() {
    const r = this._rewakes;
    this._rewakes = [];
    return r;
  }

  hasRewake() {
    return this._rewakes.length > 0;
  }

  runningCount() {
    return this._running.size;
  }

  /** Kill every in-flight hook and detach the exit reaper. Idempotent. */
  stopAll() {
    this._stopped = true;
    for (const [key, rec] of this._running) {
      try {
        clearTimeout(rec.timer);
      } catch {
        /* ignore */
      }
      try {
        rec.child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      this._running.delete(key);
    }
    try {
      process.removeListener("exit", this._exitHook);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  AsyncHookSupervisor,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT,
};
