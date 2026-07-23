/**
 * PluginMonitorSupervisor — runs installed plugins' background monitors
 * (Phase 3.3i / Phase 6 down payment). Two modes:
 *
 *   - longRunning: spawn the command ONCE and keep it alive (e.g. `tail -f`).
 *   - interval:    re-run the command every `intervalMs`, capturing each run's
 *                  output (e.g. a periodic health/log check).
 *
 * Captured stdout/stderr lines are buffered as structured records; the agent
 * loop can `drainOutputs()` them and inject them into the next turn's context
 * (Phase 6: "后台结果可在下一轮注入 additionalContext"). The supervisor owns
 * its children and reaps ALL of them on `stopAll()` plus a `process.once('exit')`
 * backstop, so no monitor process leaks past session end.
 *
 * Guardrails (Phase 6 "去重、并发上限、超时、进程回收"): a per-monitor id
 * dedupes double-starts, `maxConcurrent` caps simultaneous interval runs, and
 * `timeoutMs` kills a hung interval run. Commands run with shell:false (argv,
 * never a shell string) — no injection.
 *
 * spawn is injected via `_deps` so the whole thing is unit-testable without
 * real processes.
 */

import { executionBroker } from "./process-execution-broker/index.js";
import { EventRuntimeProducer } from "./event-runtime-producer.js";
import { EventRuntimeStore } from "./event-runtime-store.js";
import { monitorEventId } from "./monitor-event.js";

export const _deps = {
  spawn: (...args) => executionBroker.spawn(...args),
};

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 8;
const OUTPUT_RING = 200; // max buffered output records before dropping oldest

export class PluginMonitorSupervisor {
  constructor(opts = {}) {
    this.maxConcurrent = opts.maxConcurrent || DEFAULT_MAX_CONCURRENT;
    this.defaultIntervalMs = opts.defaultIntervalMs || DEFAULT_INTERVAL_MS;
    this.timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    this._spawn = opts.spawn || _deps.spawn;
    this._pluginSpawn = opts.brokerSpawn || this._spawn;
    const eventRuntimeStore =
      opts.eventRuntimeStore ||
      (process.env.CC_EVENT_RUNTIME_DURABLE === "1" ? new EventRuntimeStore() : null);
    this._runtimeProducer = eventRuntimeStore
      ? new EventRuntimeProducer({ store: eventRuntimeStore, emitter: this })
      : null;
    // id -> { desc, timer?, child?, running }
    this._monitors = new Map();
    this._outputs = []; // structured records awaiting drain
    this._runningIntervalRuns = 0;
    this._stopped = false;
    this._exitHook = () => this.stopAll();
    this._exitHookInstalled = false;
  }

  /** True when at least one monitor is registered and not stopped. */
  get size() {
    return this._monitors.size;
  }

  /**
   * Start a batch of monitor descriptors (from collectPluginMonitors). Skips a
   * monitor whose id is already running (dedupe). Returns the ids started.
   * @param {Array<object>} monitors
   * @returns {string[]} ids actually started
   */
  start(monitors = []) {
    if (this._stopped) return [];
    const started = [];
    for (const desc of monitors) {
      if (!desc || !desc.id) continue;
      if (this._monitors.has(desc.id)) continue; // dedupe double-start
      const entry = { desc, timer: null, child: null, running: false };
      this._monitors.set(desc.id, entry);
      if (desc.mode === "longRunning") {
        this._spawnLongRunning(entry);
      } else {
        // interval: run once immediately, then on a cadence.
        const ms = desc.intervalMs || this.defaultIntervalMs;
        this._runIntervalOnce(entry);
        entry.timer = setInterval(() => this._runIntervalOnce(entry), ms);
        if (typeof entry.timer.unref === "function") entry.timer.unref();
      }
      started.push(desc.id);
    }
    if (started.length > 0) this._installExitHook();
    return started;
  }

  _installExitHook() {
    if (this._exitHookInstalled) return;
    this._exitHookInstalled = true;
    // Backstop: if the caller forgets stopAll(), reap on process exit so no
    // monitor process outlives the session.
    process.once("exit", this._exitHook);
  }

  _record(desc, stream, text) {
    const lines = String(text)
      .split(/\r?\n/)
      .filter((l) => l.length > 0);
    for (const line of lines) {
      const output = {
        id: desc.id,
        plugin: desc.plugin,
        monitor: desc.name,
        stream,
        line,
      };
      this._outputs.push(output);
      try {
        this._runtimeProducer?.publish(
          { type: "monitor_output", ...output },
          { origin: "monitor", id: monitorEventId(desc.id, { stream, line }) },
        );
      } catch (error) {
        this._outputs.push({ ...output, stream: "error", line: `durable publish failed: ${error.message}` });
      }
      if (this._outputs.length > OUTPUT_RING) this._outputs.shift();
    }
  }

  _spawnLongRunning(entry) {
    const { desc } = entry;
    let child;
    try {
      child = this._spawnForDescriptor(desc, {
        cwd: desc.cwd,
        env: desc.env ? { ...process.env, ...desc.env } : process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      this._record(desc, "error", `spawn failed: ${err.message}`);
      return;
    }
    entry.child = child;
    child.stdout?.on("data", (d) =>
      this._record(desc, "stdout", d.toString("utf8")),
    );
    child.stderr?.on("data", (d) =>
      this._record(desc, "stderr", d.toString("utf8")),
    );
    child.on("error", (err) => this._record(desc, "error", err.message));
    child.on("exit", (code) => {
      entry.child = null;
      this._record(desc, "exit", `longRunning monitor exited (code ${code})`);
    });
  }

  _runIntervalOnce(entry) {
    const { desc } = entry;
    if (this._stopped) return;
    if (entry.running) return; // previous run still in flight — skip this tick
    if (this._runningIntervalRuns >= this.maxConcurrent) return; // cap
    entry.running = true;
    this._runningIntervalRuns++;
    let child;
    try {
      child = this._spawnForDescriptor(desc, {
        cwd: desc.cwd,
        env: desc.env ? { ...process.env, ...desc.env } : process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      this._record(desc, "error", `spawn failed: ${err.message}`);
      entry.running = false;
      this._runningIntervalRuns--;
      return;
    }
    entry.child = child;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (killTimer) clearTimeout(killTimer);
      entry.child = null;
      entry.running = false;
      this._runningIntervalRuns--;
    };
    const killTimer = setTimeout(() => {
      this._record(
        desc,
        "error",
        `interval run timed out after ${this.timeoutMs}ms`,
      );
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }, this.timeoutMs);
    if (typeof killTimer.unref === "function") killTimer.unref();
    child.stdout?.on("data", (d) =>
      this._record(desc, "stdout", d.toString("utf8")),
    );
    child.stderr?.on("data", (d) =>
      this._record(desc, "stderr", d.toString("utf8")),
    );
    child.on("error", (err) => {
      this._record(desc, "error", err.message);
      finish();
    });
    child.on("exit", () => finish());
  }

  _spawnForDescriptor(desc, options) {
    const isPlugin = desc?.origin === "plugin:monitor";
    return (isPlugin ? this._pluginSpawn : this._spawn)(
      desc.command,
      desc.args,
      {
        ...options,
        origin: isPlugin ? desc.origin : "plugin-monitor:process",
        policy: "allow",
        scope: "plugin-monitor",
        ...(isPlugin
          ? {
              pluginId: desc.pluginId,
              pluginVersion: desc.pluginVersion,
              pluginSource: desc.pluginSource,
            }
          : {}),
      },
    );
  }

  /**
   * Take and clear all buffered monitor output records (for injection into the
   * next agent turn). Returns [] when nothing has been captured.
   */
  drainOutputs() {
    const out = this._outputs;
    this._outputs = [];
    return out;
  }

  /** Peek at buffered output without clearing it. */
  peekOutputs() {
    return this._outputs.slice();
  }

  /** Ids of every registered monitor. */
  ids() {
    return [...this._monitors.keys()];
  }

  /**
   * Stop and reap EVERYTHING: clear interval timers, kill all children. Safe to
   * call more than once. After this, `start` is a no-op.
   */
  stopAll() {
    this._stopped = true;
    for (const entry of this._monitors.values()) {
      if (entry.timer) {
        clearInterval(entry.timer);
        entry.timer = null;
      }
      if (entry.child) {
        try {
          entry.child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
        entry.child = null;
      }
    }
    this._monitors.clear();
    this._runningIntervalRuns = 0;
    if (this._exitHookInstalled) {
      process.removeListener("exit", this._exitHook);
      this._exitHookInstalled = false;
    }
  }
}
