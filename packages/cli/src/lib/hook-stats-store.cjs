"use strict";

/**
 * hook-stats-store — a small, best-effort, cross-session RELIABILITY aggregate
 * for async settings hooks, so `cc doctor` (a separate process) can surface
 * hooks that have been slow, repeatedly failing, or circuit-broken. The gap's
 * P2 "Doctor" wants "慢/熔断 Hook" health, but that state otherwise lives only
 * in-memory in AsyncHookSupervisor for the life of one process.
 *
 * Design: the supervisor folds each completed hook run into an in-memory
 * aggregate (bounded by the number of DISTINCT hooks, not runs) and persists it
 * once on stopAll() — NOT per run — so there is no write amplification on the
 * hook hot path. Persistence merges with whatever is already on disk, so counts
 * accumulate across sessions. Reads/writes are best-effort (a corrupt/ío-failed
 * file never blocks a hook or the agent).
 *
 * Pure aggregation (no clock/RNG/fs in the fold) so it's fully unit-testable;
 * load/save take an injected fs. The default circuit threshold mirrors the
 * doctor evaluator's `hookFailureThreshold`.
 */

const os = require("node:os");
const path = require("node:path");
const fsDefault = require("node:fs");

const MAX_HOOKS = 200; // bound distinct-hook entries; drop least-recently-run
const DEFAULT_CIRCUIT_THRESHOLD = 3;
const CONFIG_DIR_NAME = ".chainlesschain";

/** Stable per-hook id from its (event, command). */
function hookKey(command, event) {
  return `${event || "*"}::${String(command || "").trim()}`;
}

/** Default on-disk location (matches the ESM getHomeDir() layout). */
function defaultHookStatsPath() {
  return path.join(os.homedir(), CONFIG_DIR_NAME, "hook-stats.json");
}

/** Fresh empty aggregate map. */
function emptyStats() {
  return {};
}

/**
 * Fold ONE completed run into the aggregate (mutates + returns `stats`). Pure:
 * `now`/`ok`/`ms` are supplied by the caller. `consecutiveFailures` resets on
 * any success — the circuit signal is "N failures in a row", not lifetime.
 */
function aggregateRun(stats, { command, event, ok, ms, now }) {
  if (!stats || typeof stats !== "object") stats = {};
  const id = hookKey(command, event);
  const dur = Number.isFinite(Number(ms)) ? Number(ms) : 0;
  const at = Number.isFinite(Number(now)) ? Number(now) : 0;
  const e = stats[id] || {
    id,
    command: command || "",
    event: event || null,
    runs: 0,
    failures: 0,
    consecutiveFailures: 0,
    lastFailureAt: null,
    totalMs: 0,
    maxMs: 0,
    lastRunAt: 0,
  };
  e.runs += 1;
  e.totalMs += dur;
  if (dur > e.maxMs) e.maxMs = dur;
  if (at > e.lastRunAt) e.lastRunAt = at;
  if (ok === true) {
    e.consecutiveFailures = 0;
  } else {
    e.failures += 1;
    e.consecutiveFailures += 1;
    e.lastFailureAt = at;
  }
  stats[id] = e;
  boundStats(stats);
  return stats;
}

/** Keep only the MAX_HOOKS most-recently-run entries. */
function boundStats(stats) {
  const keys = Object.keys(stats);
  if (keys.length <= MAX_HOOKS) return stats;
  keys
    .sort((a, b) => (stats[a].lastRunAt || 0) - (stats[b].lastRunAt || 0))
    .slice(0, keys.length - MAX_HOOKS)
    .forEach((k) => delete stats[k]);
  return stats;
}

/**
 * Merge a session `delta` aggregate INTO a `base` aggregate (returns a new map).
 * Counts add; maxMs/lastRunAt/lastFailureAt take the larger; the session's
 * consecutiveFailures wins (it reflects the most recent streak).
 */
function mergeStats(base, delta) {
  const out = {};
  for (const src of [base, delta]) {
    if (!src || typeof src !== "object") continue;
    for (const [id, e] of Object.entries(src)) {
      if (!e || typeof e !== "object") continue;
      const cur = out[id];
      if (!cur) {
        out[id] = { ...e };
        continue;
      }
      cur.runs += e.runs || 0;
      cur.failures += e.failures || 0;
      cur.totalMs += e.totalMs || 0;
      cur.maxMs = Math.max(cur.maxMs || 0, e.maxMs || 0);
      cur.lastRunAt = Math.max(cur.lastRunAt || 0, e.lastRunAt || 0);
      cur.lastFailureAt =
        Math.max(cur.lastFailureAt || 0, e.lastFailureAt || 0) || null;
      // `delta` is applied second, so its streak (most recent) wins.
      cur.consecutiveFailures =
        e.consecutiveFailures ?? cur.consecutiveFailures;
      cur.command = e.command || cur.command;
      cur.event = e.event ?? cur.event;
    }
  }
  return boundStats(out);
}

/**
 * Shape the aggregate for the doctor `checkHooks` evaluator: id, lifetime
 * failure count, average duration, and a derived circuit-open flag.
 */
function toCheckHooksInput(
  stats,
  { circuitThreshold = DEFAULT_CIRCUIT_THRESHOLD } = {},
) {
  if (!stats || typeof stats !== "object") return [];
  return Object.values(stats).map((e) => ({
    id: e.command || e.id,
    event: e.event || null,
    failures: e.failures || 0,
    avgMs: e.runs > 0 ? e.totalMs / e.runs : 0,
    circuitOpen: (e.consecutiveFailures || 0) >= circuitThreshold,
  }));
}

/** Best-effort read of the on-disk aggregate (→ {} on missing/corrupt). */
function loadHookStats(file = defaultHookStatsPath(), fs = fsDefault) {
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Best-effort atomic write (tmp + rename). Never throws. */
function saveHookStats(stats, file = defaultHookStatsPath(), fs = fsDefault) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stats), "utf-8");
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the on-disk aggregate, fold in a session `delta`, and write it back.
 * Best-effort end-to-end — the single call a supervisor makes on stopAll().
 */
function persistSessionStats(
  delta,
  file = defaultHookStatsPath(),
  fs = fsDefault,
) {
  if (!delta || Object.keys(delta).length === 0) return false;
  const merged = mergeStats(loadHookStats(file, fs), delta);
  return saveHookStats(merged, file, fs);
}

module.exports = {
  hookKey,
  defaultHookStatsPath,
  emptyStats,
  aggregateRun,
  mergeStats,
  boundStats,
  toCheckHooksInput,
  loadHookStats,
  saveHookStats,
  persistSessionStats,
  MAX_HOOKS,
  DEFAULT_CIRCUIT_THRESHOLD,
};
