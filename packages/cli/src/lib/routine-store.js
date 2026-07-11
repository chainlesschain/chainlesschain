/**
 * Routines (gap-2026-07-11 P1#8) — the durable layer above `cc agenda`:
 * named, enable/disable-able agent tasks with four trigger kinds, a run
 * history, and per-run result/usage summaries.
 *
 *   trigger kinds:
 *     cron    — 5-field schedule, fired by the `cc routine run` driver
 *     once    — a single ISO/epoch time, fired by the driver then disabled
 *     webhook — fired externally via `cc routine trigger <id>` (that command
 *               IS the API/webhook entry point — wire any HTTP receiver or
 *               inbound channel to invoke it)
 *     github  — driver polls `gh api repos/<repo>/events` and fires when new
 *               events of the requested types appear (needs gh auth)
 *
 * Storage: ~/.chainlesschain/routines/
 *   routines.json         definitions (id → routine)
 *   runs.jsonl            append-only run history
 *   logs/<runId>.log      full agent output per run
 *
 * Execution is delegated to the injected `runAgent` (production: spawn
 * `cc agent -p <prompt> --output-format json` and parse the result envelope
 * for usage/cost). Everything here is dependency-injected and unit-testable.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { parseCron, nextCronTime } from "./agent-schedule-store.js";

export const ROUTINE_TRIGGER_KINDS = Object.freeze([
  "cron",
  "once",
  "webhook",
  "github",
]);

export function routinesDir(homedir = os.homedir()) {
  return path.join(homedir, ".chainlesschain", "routines");
}

function shortId() {
  return `rt-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function parseWhen(value) {
  if (value == null) return NaN;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return Date.parse(String(value));
}

export class RoutineStore {
  constructor({ dir = null, now = () => Date.now() } = {}) {
    this.dir = dir || routinesDir();
    this._now = typeof now === "function" ? now : () => now;
  }

  _routinesFile() {
    return path.join(this.dir, "routines.json");
  }
  _runsFile() {
    return path.join(this.dir, "runs.jsonl");
  }
  logFile(runId) {
    return path.join(this.dir, "logs", `${runId}.log`);
  }
  _ensureDir() {
    fs.mkdirSync(path.join(this.dir, "logs"), { recursive: true, mode: 0o700 });
  }

  _readRoutines() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this._routinesFile(), "utf-8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  _writeRoutines(map) {
    this._ensureDir();
    fs.writeFileSync(
      this._routinesFile(),
      JSON.stringify(map, null, 2),
      "utf-8",
    );
  }

  /**
   * @param {object} def { name, prompt, trigger: {kind, cron?, at?, repo?, events?} }
   */
  create(def = {}) {
    const name = String(def.name || "").trim();
    const prompt = String(def.prompt || "").trim();
    const trigger = def.trigger || {};
    if (!name) throw new Error("routine needs a name");
    if (!prompt) throw new Error("routine needs a prompt");
    if (!ROUTINE_TRIGGER_KINDS.includes(trigger.kind)) {
      throw new Error(
        `routine trigger kind must be one of: ${ROUTINE_TRIGGER_KINDS.join(", ")}`,
      );
    }
    if (trigger.kind === "cron") {
      if (!parseCron(trigger.cron || "")) {
        throw new Error(`invalid cron expression: ${trigger.cron}`);
      }
    }
    if (trigger.kind === "once") {
      const at = parseWhen(trigger.at);
      if (!Number.isFinite(at)) {
        throw new Error(`invalid --at time: ${trigger.at}`);
      }
      trigger.at = at;
    }
    if (trigger.kind === "github" && !trigger.repo) {
      throw new Error("github trigger needs --repo <owner/name>");
    }

    const routine = {
      id: shortId(),
      name,
      prompt,
      trigger,
      enabled: true,
      createdAt: this._now(),
      lastFiredAt: null,
      lastSeenGithubEventId: null,
    };
    const map = this._readRoutines();
    map[routine.id] = routine;
    this._writeRoutines(map);
    return routine;
  }

  list() {
    return Object.values(this._readRoutines()).sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    );
  }

  get(id) {
    const map = this._readRoutines();
    if (map[id]) return map[id];
    // prefix / name match for CLI ergonomics
    const matches = Object.values(map).filter(
      (r) => r.id.startsWith(id) || r.name === id,
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(`routine "${id}" is ambiguous (${matches.length} match)`);
    }
    return null;
  }

  update(id, patch) {
    const map = this._readRoutines();
    const routine = this.get(id);
    if (!routine) throw new Error(`routine not found: ${id}`);
    const next = { ...routine, ...patch, id: routine.id };
    map[routine.id] = next;
    this._writeRoutines(map);
    return next;
  }

  setEnabled(id, enabled) {
    return this.update(id, { enabled: enabled === true });
  }

  remove(id) {
    const map = this._readRoutines();
    const routine = this.get(id);
    if (!routine) throw new Error(`routine not found: ${id}`);
    delete map[routine.id];
    this._writeRoutines(map);
    return routine;
  }

  /** Routines the driver should fire now (cron due / once reached). */
  due(nowMs = this._now()) {
    return this.list().filter((r) => {
      if (!r.enabled) return false;
      if (r.trigger.kind === "cron") {
        const from = r.lastFiredAt || r.createdAt || 0;
        const next = nextCronTime(r.trigger.cron, from);
        return next != null && next <= nowMs;
      }
      if (r.trigger.kind === "once") {
        return !r.lastFiredAt && r.trigger.at <= nowMs;
      }
      return false; // webhook/github fire through other paths
    });
  }

  /** GitHub-triggered routines the driver should poll. */
  githubRoutines() {
    return this.list().filter((r) => r.enabled && r.trigger.kind === "github");
  }

  // ── run history ──────────────────────────────────────────────────────────

  _appendRun(record) {
    this._ensureDir();
    fs.appendFileSync(this._runsFile(), JSON.stringify(record) + "\n", "utf-8");
  }

  recordRunStart(routineId, meta = {}) {
    const runId = `run-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    this._appendRun({
      type: "start",
      runId,
      routineId,
      trigger: meta.trigger || null,
      pid: meta.pid || null,
      startedAt: this._now(),
    });
    return runId;
  }

  recordRunEnd(runId, result = {}) {
    this._appendRun({
      type: "end",
      runId,
      endedAt: this._now(),
      status: result.status || (result.exitCode === 0 ? "ok" : "failed"),
      exitCode: result.exitCode ?? null,
      summary: String(result.summary || "").slice(0, 500),
      usage: result.usage || null,
      costUsd: Number.isFinite(result.costUsd) ? result.costUsd : null,
      durationMs: result.durationMs ?? null,
    });
  }

  /** Merged run rows (start+end), newest first. */
  listRuns({ routineId = null, limit = 20 } = {}) {
    let lines = [];
    try {
      lines = fs
        .readFileSync(this._runsFile(), "utf-8")
        .split("\n")
        .filter((l) => l.trim());
    } catch {
      return [];
    }
    const runs = new Map();
    for (const line of lines) {
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // per-row resilience
      }
      if (rec.type === "start") {
        runs.set(rec.runId, { ...rec, status: "running" });
      } else if (rec.type === "end") {
        const prev = runs.get(rec.runId) || { runId: rec.runId };
        runs.set(rec.runId, { ...prev, ...rec, type: undefined });
      }
    }
    return [...runs.values()]
      .filter((r) => !routineId || r.routineId === routineId)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      .slice(0, limit)
      .map(({ type: _t, ...rest }) => rest);
  }

  /** Per-routine aggregate for `cc routine list`: runs, ok/failed, cost. */
  summarize(routineId) {
    const runs = this.listRuns({ routineId, limit: 1000 });
    const done = runs.filter((r) => r.status && r.status !== "running");
    return {
      totalRuns: runs.length,
      ok: done.filter((r) => r.status === "ok").length,
      failed: done.filter((r) => r.status === "failed").length,
      running: runs.filter((r) => r.status === "running").length,
      costUsd: done.reduce(
        (sum, r) => sum + (Number.isFinite(r.costUsd) ? r.costUsd : 0),
        0,
      ),
      lastRun: runs[0] || null,
    };
  }
}

/**
 * Fire one routine: record history, run the agent, persist the log, update
 * lastFiredAt (and disable a fired `once`). `runAgent({prompt})` must resolve
 * `{ exitCode, output, usage?, costUsd?, pid? }`.
 */
export async function fireRoutine(store, routine, runAgent, meta = {}) {
  const startedAt = store._now();
  const runId = store.recordRunStart(routine.id, {
    trigger: meta.trigger || routine.trigger.kind,
  });
  let result;
  try {
    result = await runAgent({ prompt: routine.prompt, routine, runId });
  } catch (err) {
    result = { exitCode: -1, output: `runner error: ${err.message}` };
  }
  const output = String(result.output || "");
  try {
    store._ensureDir();
    fs.writeFileSync(store.logFile(runId), output, "utf-8");
  } catch {
    /* log persistence is best-effort */
  }
  store.recordRunEnd(runId, {
    exitCode: result.exitCode,
    status: result.exitCode === 0 ? "ok" : "failed",
    summary: output.trim().split("\n").slice(-3).join(" ⏎ "),
    usage: result.usage || null,
    costUsd: result.costUsd,
    durationMs: store._now() - startedAt,
  });
  store.update(routine.id, {
    lastFiredAt: startedAt,
    ...(routine.trigger.kind === "once" ? { enabled: false } : {}),
  });
  return runId;
}

/**
 * Poll a github-triggered routine: fetch the repo's latest events via the
 * injected `fetchEvents(repo)` (production: `gh api repos/<repo>/events`),
 * fire when new events of the requested types appeared. Returns fired runIds.
 */
export async function pollGithubRoutine(
  store,
  routine,
  { fetchEvents, runAgent },
) {
  const events = (await fetchEvents(routine.trigger.repo)) || [];
  const wanted = Array.isArray(routine.trigger.events)
    ? routine.trigger.events
    : null;
  const fresh = events.filter((e) => {
    if (wanted && wanted.length > 0 && !wanted.includes(e.type)) return false;
    return (
      !routine.lastSeenGithubEventId ||
      String(e.id) > String(routine.lastSeenGithubEventId)
    );
  });
  const newestId = events.length ? String(events[0].id) : null;
  if (newestId) {
    store.update(routine.id, { lastSeenGithubEventId: newestId });
  }
  if (fresh.length === 0) return [];
  const runId = await fireRoutine(store, routine, runAgent, {
    trigger: `github:${fresh.map((e) => e.type).join(",")}`,
  });
  return [runId];
}
