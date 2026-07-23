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
 *   - a per-hook timeout that TREE-kills the child (shell + the real command it
 *     spawned — a bare child.kill would orphan the grandchild);
 *   - tree-reaping of every child on stopAll() / process 'exit', so a session
 *     never leaves an orphan hook process.
 *
 * Process runners and `_deps.now` are injected so the whole supervisor is unit-
 * testable with fake child processes (no real shell).
 */

const { tryParseDecision } = require("./hook-runner.cjs");

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const DEFAULT_MAX_CONCURRENT = 4;
// Ring cap on undrained records (parity with PluginMonitorSupervisor's
// OUTPUT_RING): drainResults()/drainRewakes() normally clear each turn, but a
// stalled/absent drain over a high-frequency hook would otherwise grow these
// arrays without bound. Keep only the most recent RESULT_RING; older records
// are dropped oldest-first.
const RESULT_RING = 500;

class AsyncHookSupervisor {
  constructor(opts = {}) {
    this.maxConcurrent =
      Number(opts.maxConcurrent) > 0
        ? Number(opts.maxConcurrent)
        : DEFAULT_MAX_CONCURRENT;
    this._deps = {
      run: opts.run || opts.spawn || null,
      runSync: opts.runSync || opts.spawnSync || null,
      killProcess: opts.killProcess || process.kill.bind(process),
      platform: opts.platform || process.platform,
      now: opts.now || (() => Date.now()),
    };
    this._running = new Map(); // key -> { child, timer }
    this._results = []; // completed records awaiting drainResults()
    this._rewakes = []; // failed asyncRewake records awaiting drainRewakes()
    this._stopped = false;
    // Reliability aggregate for `cc doctor` (慢/熔断 Hook). Folded in-memory on
    // each completion and persisted ONCE on stopAll() — never per run, so the
    // hook hot path takes no extra I/O. Persistence is opt-in: production passes
    // `persistStats:true` (→ default path) or an explicit `hookStatsPath`; tests
    // that pass neither stay hermetic (aggregation still runs, just no write).
    this._statAgg = {};
    this._statsStore = opts.statsStore || require("./hook-stats-store.cjs");
    this._hookStatsPath =
      opts.hookStatsPath ||
      (opts.persistStats === true
        ? this._statsStore.defaultHookStatsPath()
        : null);
    this._statsFs = opts.statsFs || null; // injected fs for tests
    // Persistent rewake queue (opt-in). A rewake — an async check that OPTED IN
    // and finished in a FAILURE state — is the one actionable signal this
    // supervisor produces, but it lives only in `_rewakes` until the turn loop
    // drains it. If the process dies in that window the failure is lost. When a
    // `sessionId` + `persistQueue` (or an explicit `queuePath`) are supplied,
    // each rewake is durably parked keyed by session so `--resume` can recover
    // it; it's removed again the moment the run drains it. Disabled (no writes,
    // byte-unchanged) when either is absent — mirrors the stats-store opt-in.
    this._queueStore = opts.queueStore || require("./async-hook-queue.cjs");
    this._queueSessionId = opts.sessionId ? String(opts.sessionId) : null;
    this._queuePath =
      opts.queuePath ||
      (opts.persistQueue === true
        ? this._queueStore.defaultAsyncHookQueuePath()
        : null);
    this._queueFs = opts.queueFs || null; // injected fs for tests
    // The exit reaper is installed LAZILY (on first spawn), not in the ctor:
    // a supervisor that never dispatches a hook (or the many built in tests)
    // must not leave a permanent `process.once('exit')` listener behind —
    // that accumulates across sessions/instances into a MaxListenersExceeded
    // leak. Mirrors PluginMonitorSupervisor._installExitHook.
    this._exitHook = () => this.stopAll();
    this._exitHookInstalled = false;
  }

  _key(hook) {
    return `${hook.event || ""}::${hook.command}`;
  }

  /**
   * Kill a hook child's WHOLE process tree. Hooks run with `shell: true`, so the
   * real command is a grandchild of the shell — a plain `child.kill()` only
   * signals the shell (POSIX: reparents + keeps the command running; Windows:
   * killing cmd.exe never touches its children), orphaning the actual hook
   * process. POSIX: the child is spawned detached (its own group), so a negative
   * pid signals the whole group. Windows: `taskkill /T` walks the tree. Both are
   * SYNCHRONOUS (spawnSync / process.kill) so this is safe inside stopAll() and
   * the process 'exit' reaper, where async work would be cut off. A child with no
   * real pid (the unit-test fakes) falls back to its own `.kill()`.
   */
  _killChildTree(child, signal = "SIGTERM") {
    if (!child) return;
    const pid = child.pid;
    if (typeof pid !== "number" || pid <= 0) {
      try {
        child.kill(signal);
      } catch {
        /* already gone / fake with no kill */
      }
      return;
    }
    try {
      if (this._deps.platform === "win32") {
        // Snapshot before taskkill: a policy-restricted taskkill may terminate
        // the shell and then fail on its descendants, orphaning them so a
        // parent-PID query performed afterward can no longer find the tree.
        const descendants = this._windowsDescendantPids(pid);
        const r = this._deps.runSync(
          "taskkill",
          ["/PID", String(pid), "/T", "/F"],
          { windowsHide: true },
        );
        // A shell can publish a just-created descendant between the first
        // tree snapshot and termination. Repeat once so that race cannot
        // leave a short-lived hook grandchild orphaned.
        if (!r?.error && r?.status === 0) {
          this._deps.runSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            windowsHide: true,
          });
        }
        // Restricted runners can launch taskkill but still receive a non-zero
        // access/policy result. Enumerate the tree while it is still alive,
        // then terminate descendants leaf-first before killing the shell.
        if (r && (r.error || (r.status != null && r.status !== 0))) {
          for (const descendant of descendants.reverse()) {
            try {
              this._deps.killProcess(descendant, "SIGKILL");
            } catch {
              /* already gone */
            }
          }
          child.kill(signal);
        }
      } else {
        // Negative pid → the whole process group (requires the detached spawn).
        try {
          this._deps.killProcess(-pid, signal);
        } catch {
          child.kill(signal);
        }
      }
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  }

  /**
   * Snapshot a Windows process tree for the taskkill-denied fallback. Query the
   * process table once instead of issuing a quoted WMIC `where` expression for
   * every level: Node/cmd quoting can silently turn that expression into an
   * invalid WMIC alias query. PowerShell/CIM covers systems where WMIC has been
   * removed. Traversal is bounded + cycle-safe so corrupt data cannot stall
   * session teardown.
   */
  _windowsDescendantPids(rootPid) {
    if (this._deps.platform !== "win32") return [];
    const root = Number(rootPid);
    if (!Number.isInteger(root) || root <= 0) return [];
    let output = "";
    let shouldTryCim = false;
    try {
      const result = this._deps.runSync(
        "wmic",
        [
          "path",
          "Win32_Process",
          "get",
          "ParentProcessId,ProcessId",
          "/format:csv",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 3000,
        },
      );
      if (!result?.error && result?.status === 0) {
        output = String(result.stdout || "");
      } else if (result?.error?.code === "ENOENT") {
        shouldTryCim = true;
      }
    } catch {
      shouldTryCim = true;
    }
    if (!output && shouldTryCim) {
      try {
        const result = this._deps.runSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_Process | ForEach-Object { '{0},{1}' -f $_.ParentProcessId,$_.ProcessId }",
          ],
          {
            encoding: "utf8",
            windowsHide: true,
            timeout: 3000,
          },
        );
        if (!result?.error && result?.status === 0) {
          output = String(result.stdout || "");
        }
      } catch {
        return [];
      }
    }

    const childrenByParent = new Map();
    for (const line of output.split(/\r?\n/)) {
      const fields = line.trim().split(",");
      if (fields.length < 2) continue;
      const parentPid = Number(fields.at(-2));
      const childPid = Number(fields.at(-1));
      if (
        !Number.isInteger(parentPid) ||
        parentPid < 0 ||
        !Number.isInteger(childPid) ||
        childPid <= 0
      ) {
        continue;
      }
      const children = childrenByParent.get(parentPid) || [];
      children.push(childPid);
      childrenByParent.set(parentPid, children);
    }

    const seen = new Set([root]);
    const pending = [root];
    const descendants = [];
    while (pending.length > 0 && seen.size <= 256) {
      const parentPid = pending.shift();
      for (const childPid of childrenByParent.get(parentPid) || []) {
        if (seen.has(childPid)) continue;
        seen.add(childPid);
        descendants.push(childPid);
        pending.push(childPid);
      }
    }
    return descendants;
  }

  /** Install the process-exit reaper exactly once, only when a child exists. */
  _installExitHook() {
    if (this._exitHookInstalled) return;
    this._exitHookInstalled = true;
    process.once("exit", this._exitHook);
  }

  /** Append a result record, bounded to the most recent RESULT_RING. */
  _pushResult(rec) {
    this._results.push(rec);
    if (this._results.length > RESULT_RING) this._results.shift();
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
        this._pushResult({
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
    // A live child now exists — arm the exit reaper so a session never leaves
    // an orphan hook process (installed once, only from here).
    this._installExitHook();
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
      const spawnOptions = {
        cwd: opts.cwd || process.cwd(),
        shell: true,
        // POSIX: own process group so a timeout / stopAll can signal the whole
        // tree (shell + the real hook command), not just the shell wrapper.
        // No-op on Windows, where the tree is reaped via `taskkill /T` instead.
        detached: this._deps.platform !== "win32",
        env: {
          ...process.env,
          CLAUDE_HOOK_EVENT: hook.event || payload.hook_event_name || "",
        },
      };
      if (typeof this._deps.run !== "function") {
        throw new Error("async hook process runner unavailable");
      }
      child = this._deps.run(hook.command, {
        ...spawnOptions,
        origin: hook.origin || "async-hook:command",
        policy: "allow",
        scope: "async-hook",
        pluginId: hook.pluginId || null,
        pluginVersion: hook.pluginVersion || null,
        pluginSource: hook.pluginSource || null,
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
      // `.end(data)` flushes ASYNCHRONOUSLY: if the hook exited before consuming
      // stdin (a fast command), the write fails with an async EPIPE emitted as an
      // 'error' event on the stream — NOT a sync throw this catch can see. With no
      // listener that becomes an uncaught exception that crashes the process (seen
      // on Linux CI). Attach a no-op error handler first so a closed-stdin write
      // is swallowed as the non-fatal condition it is.
      child.stdin?.on("error", () => {});
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
      // Tree-kill: a hook that spawned a subprocess (e.g. `npm test`) must not
      // leave that subprocess orphaned when it exceeds its timeout.
      this._killChildTree(child, "SIGTERM");
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
      asyncRewake: hook.asyncRewake === true,
      ts: now,
      ms: fields.started != null ? now - fields.started : 0,
    };
    this._pushResult(rec);
    // Fold this run into the reliability aggregate (in-memory, bounded by
    // distinct hooks). Persisted once on stopAll(); best-effort — a stats bug
    // must never affect hook execution.
    try {
      this._statsStore.aggregateRun(this._statAgg, {
        command: rec.command,
        event: rec.event,
        ok: rec.ok,
        ms: rec.ms,
        now: rec.ts,
      });
    } catch {
      /* stats are best-effort */
    }
    // A rewake fires only for a hook that OPTED IN and finished in a failure
    // state — a passing async check should not re-engage the agent.
    if (hook.asyncRewake && !rec.ok) {
      this._rewakes.push(rec);
      if (this._rewakes.length > RESULT_RING) this._rewakes.shift();
      // Durably park it (opt-in) so a crash before the turn loop drains this
      // rewake doesn't lose the failure signal. Immediate write, not deferred to
      // stopAll — a rewake must survive even a hard exit that never runs stopAll.
      this._persistRewake(rec);
    }
  }

  /** True when a session id + queue location were both configured. */
  _queueEnabled() {
    return !!(this._queueSessionId && this._queuePath);
  }

  /** Best-effort durable append of one rewake record. Never throws. */
  _persistRewake(rec) {
    if (!this._queueEnabled()) return;
    try {
      this._queueStore.appendRewake(
        { sessionId: this._queueSessionId, records: [rec], now: rec.ts },
        this._queuePath,
        this._queueFs || undefined,
      );
    } catch {
      /* queue is best-effort */
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
    // The run has now consumed these rewakes (it will surface / re-engage on
    // them), so they no longer need to survive a crash — drop the durable copies.
    if (r.length > 0 && this._queueEnabled()) {
      try {
        this._queueStore.removeRewakes(
          { sessionId: this._queueSessionId, records: r },
          this._queuePath,
          this._queueFs || undefined,
        );
      } catch {
        /* queue is best-effort */
      }
    }
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
      // Tree-kill (not a bare child.kill) so a session end / process exit never
      // leaves an orphaned hook subprocess — the guarantee this class documents.
      this._killChildTree(rec.child, "SIGTERM");
      this._running.delete(key);
    }
    try {
      process.removeListener("exit", this._exitHook);
    } catch {
      /* ignore */
    }
    this._exitHookInstalled = false;
    this._persistStats();
  }

  /**
   * Best-effort persist of the session's hook reliability aggregate, merged with
   * whatever is already on disk (accumulates across sessions). No-op when
   * persistence wasn't enabled or nothing was recorded. Never throws — called
   * from stopAll(), which also runs on process 'exit'.
   */
  _persistStats() {
    if (!this._hookStatsPath) return;
    try {
      const fs = this._statsFs || undefined;
      this._statsStore.persistSessionStats(
        this._statAgg,
        this._hookStatsPath,
        fs,
      );
      this._statAgg = {}; // folded in — don't double-count on a later stop
    } catch {
      /* persistence is best-effort */
    }
  }

  /** Current in-memory reliability aggregate (test/inspection accessor). */
  getStatsAggregate() {
    return this._statAgg;
  }
}

module.exports = {
  AsyncHookSupervisor,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT,
};
