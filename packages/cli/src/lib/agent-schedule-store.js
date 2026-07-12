/**
 * AgentScheduleStore — persistent backing for the agent-callable Monitor /
 * Cron / Wakeup tools (gap-analysis 第四阶段 #3).
 *
 * A one-shot `cc agent` turn cannot itself keep a timer alive, so these tools
 * PERSIST their intent to a JSONL store under
 * `~/.chainlesschain/agent-schedule/<kind>.jsonl`; a supervising loop / cron
 * (`cc agenda run`) reads due entries and acts. This mirrors how Claude Code's
 * Monitor/CronCreate/ScheduleWakeup outlive a single turn.
 *
 * Three entry kinds share one store:
 *   - wakeup   one-shot: run `prompt` (a `cc agent -p`) once at/after `dueAt`.
 *   - cron     recurring: run `prompt` on a cron schedule; `nextAt` advances.
 *   - monitor  recurring watch: run `command` (shell) every `intervalMs`;
 *              fire the `notify` payload when `stopWhen` regex matches output.
 *
 * Pure over an injected clock + directory so it is fully unit-testable. Cron
 * parsing is a compact 5-field evaluator (min hour dom mon dow) supporting
 * `* , - /` — enough for the scheduling the agent actually asks for.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { isEntryExpired } from "./schedule-planner.js";

export const SCHEDULE_KINDS = Object.freeze(["wakeup", "cron", "monitor"]);

/** A valid absolute-epoch-ms expiry, or null (never expires). */
function normalizeExpiresAt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Is an entry currently in a schedulable (non-terminal) state? */
function isSchedulableStatus(entry) {
  return entry.kind === "wakeup"
    ? entry.status === "pending"
    : entry.status === "active";
}

/** Statuses an entry can never leave — safe to prune. */
export const TERMINAL_STATUSES = Object.freeze([
  "fired",
  "matched",
  "exhausted",
  "expired",
]);
const TERMINAL_SET = new Set(TERMINAL_STATUSES);

/** Best available "this entry reached a terminal state at" timestamp. */
function terminalAt(entry) {
  return (
    entry.firedAt ??
    entry.matchedAt ??
    entry.expiredAt ??
    entry.lastRunAt ??
    entry.lastCheckAt ??
    entry.createdAt ??
    0
  );
}

export function agentScheduleDir(homedir = os.homedir()) {
  return path.join(homedir, ".chainlesschain", "agent-schedule");
}

// ─── cron (5-field) ────────────────────────────────────────────────────────

const CRON_RANGES = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0/7 = Sunday)
];

function parseCronField(field, [min, max]) {
  const values = new Set();
  for (const part of String(field).split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step < 1) {
      throw new Error(`invalid cron step in "${field}"`);
    }
    let lo = min;
    let hi = max;
    if (rangePart !== "*" && rangePart !== "") {
      const bounds = rangePart.split("-");
      lo = parseInt(bounds[0], 10);
      hi = bounds.length > 1 ? parseInt(bounds[1], 10) : lo;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        throw new Error(`invalid cron range in "${field}"`);
      }
    }
    for (let v = lo; v <= hi; v += step) {
      if (v < min || v > max) throw new Error(`cron value out of range: ${v}`);
      values.add(v);
    }
  }
  return values;
}

/** Parse a 5-field cron expression into per-field value sets. Throws on junk. */
export function parseCron(expr) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `cron expression must have 5 fields (min hour dom mon dow), got ${fields.length}`,
    );
  }
  return fields.map((field, i) => parseCronField(field, CRON_RANGES[i]));
}

function cronMatches(sets, date) {
  const dow = date.getDay(); // 0-6, Sun=0
  return (
    sets[0].has(date.getMinutes()) &&
    sets[1].has(date.getHours()) &&
    sets[2].has(date.getDate()) &&
    sets[3].has(date.getMonth() + 1) &&
    (sets[4].has(dow) || (sets[4].has(7) && dow === 0))
  );
}

/**
 * Next epoch-ms at which `expr` fires strictly after `fromMs` (local time,
 * minute granularity). Scans up to ~366 days then gives up (returns null) so a
 * never-matching expression can't loop forever.
 */
export function nextCronTime(expr, fromMs) {
  const sets = parseCron(expr);
  const cursor = new Date(fromMs);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i += 1) {
    if (cronMatches(sets, cursor)) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

// ─── store ───────────────────────────────────────────────────────────────

export class AgentScheduleStore {
  constructor({ dir = null, now = () => Date.now() } = {}) {
    this.dir = dir || agentScheduleDir();
    this._now = typeof now === "function" ? now : () => now;
  }

  _file(kind) {
    return path.join(this.dir, `${kind}.jsonl`);
  }

  _ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  _readAll(kind) {
    let raw;
    try {
      raw = fs.readFileSync(this._file(kind), "utf-8");
    } catch {
      return [];
    }
    const entries = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {
        // Skip a corrupt line rather than throwing — one bad append must not
        // poison the whole store (per-row resilience, like the JSON.parse sweep).
      }
    }
    return entries;
  }

  _writeAll(kind, entries) {
    this._ensureDir();
    const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
    fs.writeFileSync(this._file(kind), body ? body + "\n" : "", {
      encoding: "utf-8",
      mode: 0o600,
    });
  }

  // ── create ──────────────────────────────────────────────────────────────

  scheduleWakeup({
    prompt,
    delayMs = 0,
    dueAt = null,
    label = null,
    expiresAt = null,
  } = {}) {
    if (!prompt || typeof prompt !== "string") {
      throw new Error("wakeup requires a prompt");
    }
    const now = this._now();
    const entry = {
      id: randomUUID(),
      kind: "wakeup",
      prompt,
      label: label || null,
      dueAt:
        dueAt != null ? Number(dueAt) : now + Math.max(0, Number(delayMs) || 0),
      expiresAt: normalizeExpiresAt(expiresAt),
      createdAt: now,
      status: "pending",
    };
    const entries = this._readAll("wakeup");
    entries.push(entry);
    this._writeAll("wakeup", entries);
    return entry;
  }

  createCron({ prompt, cron, label = null, expiresAt = null } = {}) {
    if (!prompt || typeof prompt !== "string") {
      throw new Error("cron requires a prompt");
    }
    const now = this._now();
    const nextAt = nextCronTime(cron, now); // validates the expression too
    if (nextAt == null) {
      throw new Error(`cron "${cron}" has no upcoming match`);
    }
    const entry = {
      id: randomUUID(),
      kind: "cron",
      prompt,
      cron,
      label: label || null,
      nextAt,
      expiresAt: normalizeExpiresAt(expiresAt),
      createdAt: now,
      lastRunAt: null,
      runs: 0,
      status: "active",
    };
    const entries = this._readAll("cron");
    entries.push(entry);
    this._writeAll("cron", entries);
    return entry;
  }

  createMonitor({
    command,
    watchFile = null,
    watchUrl = null,
    intervalMs,
    stopWhen = null,
    notify = null,
    maxChecks = null,
    label = null,
    expiresAt = null,
  } = {}) {
    // A monitor watches exactly one source:
    //   - a shell `command`  → match its stdout/stderr
    //   - a `watchFile`      → match its content, or fire when the file appears
    //   - a `watchUrl`       → GET it and match the response body, or fire on 2xx
    const hasCommand = typeof command === "string" && command.length > 0;
    const hasFile = typeof watchFile === "string" && watchFile.length > 0;
    const hasUrl = typeof watchUrl === "string" && watchUrl.length > 0;
    const sourceCount = Number(hasCommand) + Number(hasFile) + Number(hasUrl);
    if (sourceCount !== 1) {
      throw new Error(
        "monitor requires exactly one of `command`, `watchFile`, or `watchUrl`",
      );
    }
    if (hasUrl) {
      // Only http(s) endpoints — reject file:// and other schemes up-front so a
      // bad URL errors at creation, not silently at the first poll.
      let parsed;
      try {
        parsed = new URL(watchUrl);
      } catch {
        throw new Error(`monitor watchUrl is not a valid URL: ${watchUrl}`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(
          `monitor watchUrl must be http(s), got: ${parsed.protocol}`,
        );
      }
    }
    const interval = Math.max(1000, Number(intervalMs) || 60000);
    if (stopWhen != null) {
      // Validate the regex up-front so a bad pattern errors at creation, not
      // silently at the first check.
      // eslint-disable-next-line no-new
      new RegExp(stopWhen);
    }
    const now = this._now();
    const source = hasFile ? "file" : hasUrl ? "http" : "command";
    const entry = {
      id: randomUUID(),
      kind: "monitor",
      source,
      command: hasCommand ? command : null,
      watchFile: hasFile ? watchFile : null,
      watchUrl: hasUrl ? watchUrl : null,
      intervalMs: interval,
      stopWhen: stopWhen || null,
      notify: notify || null,
      maxChecks: maxChecks != null ? Number(maxChecks) : null,
      label: label || null,
      nextAt: now + interval,
      expiresAt: normalizeExpiresAt(expiresAt),
      createdAt: now,
      checks: 0,
      status: "active",
    };
    const entries = this._readAll("monitor");
    entries.push(entry);
    this._writeAll("monitor", entries);
    return entry;
  }

  // ── query ─────────────────────────────────────────────────────────────────

  list(kind = null) {
    const kinds = kind ? [kind] : SCHEDULE_KINDS;
    const out = [];
    for (const k of kinds) out.push(...this._readAll(k));
    return out;
  }

  /** Entries whose time has come (pending wakeup / active cron|monitor). */
  due(kind = null, atMs = null) {
    const now = atMs != null ? atMs : this._now();
    return this.list(kind).filter((entry) => {
      // An entry past its expiry never fires — even if it is not yet retired
      // (defense-in-depth: retireExpired need not have run first).
      if (isEntryExpired(entry, now)) return false;
      if (entry.kind === "wakeup") {
        return entry.status === "pending" && entry.dueAt <= now;
      }
      return entry.status === "active" && entry.nextAt <= now;
    });
  }

  /**
   * Retire every schedulable entry whose `expiresAt` has passed (status →
   * "expired", stamping `expiredAt`), across all kinds, so it never fires again.
   * A daemon / `cc agenda run` calls this before firing due entries — mirroring
   * the schedule-planner's "retire expired BEFORE due" semantics. Returns the
   * list of retired entries.
   */
  retireExpired(atMs = null) {
    const now = atMs != null ? atMs : this._now();
    const retired = [];
    for (const kind of SCHEDULE_KINDS) {
      const entries = this._readAll(kind);
      let changed = false;
      for (const entry of entries) {
        if (isSchedulableStatus(entry) && isEntryExpired(entry, now)) {
          entry.status = "expired";
          entry.expiredAt = now;
          retired.push(entry);
          changed = true;
        }
      }
      if (changed) this._writeAll(kind, entries);
    }
    return retired;
  }

  cancel(id) {
    for (const kind of SCHEDULE_KINDS) {
      const entries = this._readAll(kind);
      const idx = entries.findIndex((entry) => entry.id === id);
      if (idx >= 0) {
        const [removed] = entries.splice(idx, 1);
        this._writeAll(kind, entries);
        return removed;
      }
    }
    return null;
  }

  /**
   * Remove terminal entries (fired / matched / exhausted / expired) whose
   * terminal timestamp is at or before `before` (default: all terminal
   * entries), across all kinds. Keeps the append-only JSONL store from growing
   * without bound once entries finish. Returns the removed entries; only a kind
   * that actually changed is rewritten.
   */
  pruneTerminal({ before = Infinity } = {}) {
    const removed = [];
    for (const kind of SCHEDULE_KINDS) {
      const entries = this._readAll(kind);
      const keep = entries.filter((entry) => {
        const prunable =
          TERMINAL_SET.has(entry.status) && terminalAt(entry) <= before;
        if (prunable) removed.push(entry);
        return !prunable;
      });
      if (keep.length !== entries.length) this._writeAll(kind, keep);
    }
    return removed;
  }

  // ── lifecycle mutations (used by `cc agenda run`) ──────────────────────────

  /** Mark a one-shot wakeup fired (keeps history; due() skips it). */
  markWakeupFired(id, atMs = null) {
    return this._mutate("wakeup", id, (entry) => {
      entry.status = "fired";
      entry.firedAt = atMs != null ? atMs : this._now();
    });
  }

  /** Advance a cron entry to its next fire time after running once. */
  advanceCron(id, atMs = null) {
    const now = atMs != null ? atMs : this._now();
    return this._mutate("cron", id, (entry) => {
      entry.lastRunAt = now;
      entry.runs = (entry.runs || 0) + 1;
      const next = nextCronTime(entry.cron, now);
      if (next == null) {
        entry.status = "exhausted";
      } else {
        entry.nextAt = next;
      }
    });
  }

  /**
   * Record a monitor check. `matched` ends the monitor (done); otherwise it is
   * re-armed for the next interval, or exhausted once maxChecks is hit.
   */
  recordMonitorCheck(id, { matched = false, atMs = null } = {}) {
    const now = atMs != null ? atMs : this._now();
    return this._mutate("monitor", id, (entry) => {
      entry.checks = (entry.checks || 0) + 1;
      entry.lastCheckAt = now;
      if (matched) {
        entry.status = "matched";
        entry.matchedAt = now;
      } else if (entry.maxChecks != null && entry.checks >= entry.maxChecks) {
        entry.status = "exhausted";
      } else {
        entry.nextAt = now + entry.intervalMs;
      }
    });
  }

  _mutate(kind, id, fn) {
    const entries = this._readAll(kind);
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    fn(entry);
    this._writeAll(kind, entries);
    return entry;
  }
}
