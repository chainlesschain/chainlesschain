/**
 * Cowork Cron — schedule and run daily Cowork tasks on a cron.
 *
 * Persists schedules to `.chainlesschain/cowork/schedules.jsonl` (one JSON
 * object per line). Schedules have shape:
 *
 *   {
 *     id: "sch-...",
 *     cron: "0 9 * * 1-5",       // 5-field POSIX cron
 *     templateId: "doc-convert",  // or null for free mode
 *     userMessage: "...",         // task prompt
 *     files: ["/abs/path/..."],   // optional
 *     enabled: true,
 *     createdAt: ISO,
 *     lastRunAt: ISO|null,
 *     lastStatus: "completed"|"failed"|null,
 *   }
 *
 * The scheduler ticks every 60s. Each tick it reloads schedules and runs
 * any whose cron expression matches the current minute (rounded down).
 * A schedule only runs once per minute, even if the tick fires twice.
 *
 * @module cowork-cron
 */

import crypto from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const _deps = {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  now: () => new Date(),
  runTask: null, // injected at runtime to avoid circular import
};

// ─── Cron parser ─────────────────────────────────────────────────────────────

const FIELD_RANGES = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day-of-month
  [1, 12], // month
  [0, 6],  // day-of-week (0=Sun, 6=Sat). 7 also maps to 0.
];

/**
 * Parse a single cron field into a Set of matching integers.
 * Supports:
 *   *              — every value in range
 *   N              — single number
 *   A-B            — inclusive range
 *   *\/N or A-B/N — step (every Nth value)
 *   a,b,c          — comma-separated list (any combination of the above)
 */
export function parseCronField(field, [min, max]) {
  if (typeof field !== "string" || field.length === 0) {
    throw new Error("empty cron field");
  }
  const values = new Set();
  for (const part of field.split(",")) {
    const slashIdx = part.indexOf("/");
    const stepStr = slashIdx >= 0 ? part.slice(slashIdx + 1) : null;
    const base = slashIdx >= 0 ? part.slice(0, slashIdx) : part;
    const step = stepStr === null ? 1 : parseInt(stepStr, 10);
    if (!Number.isFinite(step) || step < 1) {
      throw new Error(`invalid cron step: ${part}`);
    }
    let lo, hi;
    if (base === "*") {
      lo = min;
      hi = max;
    } else if (base.includes("-")) {
      const [a, b] = base.split("-").map((x) => parseInt(x, 10));
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new Error(`invalid cron range: ${part}`);
      }
      lo = a;
      hi = b;
    } else {
      const n = parseInt(base, 10);
      if (!Number.isFinite(n)) {
        throw new Error(`invalid cron value: ${part}`);
      }
      lo = n;
      hi = n;
    }
    // Normalize day-of-week 7 → 0
    if (max === 6 && lo === 7) lo = 0;
    if (max === 6 && hi === 7) hi = 0;
    if (lo < min || hi > max || lo > hi) {
      throw new Error(`cron value out of range ${min}-${max}: ${part}`);
    }
    for (let v = lo; v <= hi; v += step) {
      values.add(v);
    }
  }
  return values;
}

/**
 * Parse a 5-field cron expression. Returns a match function.
 *
 * @param {string} expr
 * @returns {(date: Date) => boolean}
 */
export function parseCron(expr) {
  if (typeof expr !== "string") {
    throw new Error("cron expression must be a string");
  }
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `cron must have 5 fields (minute hour dom month dow), got ${parts.length}`,
    );
  }
  const [minute, hour, dom, month, dow] = parts.map((p, i) =>
    parseCronField(p, FIELD_RANGES[i]),
  );
  return function matches(date) {
    const m = date.getMinutes();
    const h = date.getHours();
    const D = date.getDate();
    const M = date.getMonth() + 1; // JS month is 0-based
    const W = date.getDay();
    if (!minute.has(m)) return false;
    if (!hour.has(h)) return false;
    if (!month.has(M)) return false;
    // POSIX: if both dom and dow are restricted (not *), match is OR.
    // If only one is restricted, that one applies. If both *, always match.
    const partsRaw = expr.trim().split(/\s+/);
    const domRestricted = partsRaw[2] !== "*";
    const dowRestricted = partsRaw[4] !== "*";
    if (domRestricted && dowRestricted) {
      return dom.has(D) || dow.has(W);
    }
    if (domRestricted) return dom.has(D);
    if (dowRestricted) return dow.has(W);
    return true;
  };
}

/** Validate a cron expression — returns null if valid, error string otherwise. */
export function validateCron(expr) {
  try {
    parseCron(expr);
    return null;
  } catch (err) {
    return err.message;
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function _scheduleFile(cwd) {
  return join(cwd, ".chainlesschain", "cowork", "schedules.jsonl");
}

/** Load all schedules from disk. Returns [] if the file doesn't exist. */
export function loadSchedules(cwd) {
  const file = _scheduleFile(cwd);
  if (!_deps.existsSync(file)) return [];
  const raw = _deps.readFileSync(file, "utf-8");
  const out = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch (_e) {
      // Skip malformed lines — don't let one bad record break the rest
    }
  }
  return out;
}

/** Write the full schedule list back to disk, overwriting. */
export function saveSchedules(cwd, schedules) {
  const dir = join(cwd, ".chainlesschain", "cowork");
  _deps.mkdirSync(dir, { recursive: true });
  const file = _scheduleFile(cwd);
  const body = schedules.map((s) => JSON.stringify(s)).join("\n");
  _deps.writeFileSync(file, body ? body + "\n" : "", "utf-8");
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function addSchedule(cwd, input) {
  const { cron, templateId = null, userMessage, files = [] } = input || {};
  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }
  const err = validateCron(cron);
  if (err) throw new Error(`invalid cron: ${err}`);

  const schedules = loadSchedules(cwd);
  const entry = {
    id: `sch-${crypto.randomUUID().slice(0, 12)}`,
    cron: cron.trim(),
    templateId,
    userMessage,
    files: Array.isArray(files) ? files : [],
    enabled: true,
    createdAt: _deps.now().toISOString(),
    lastRunAt: null,
    lastStatus: null,
  };
  schedules.push(entry);
  saveSchedules(cwd, schedules);
  return entry;
}

export function removeSchedule(cwd, id) {
  const schedules = loadSchedules(cwd);
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  schedules.splice(idx, 1);
  saveSchedules(cwd, schedules);
  return true;
}

export function setScheduleEnabled(cwd, id, enabled) {
  const schedules = loadSchedules(cwd);
  const s = schedules.find((x) => x.id === id);
  if (!s) return false;
  s.enabled = !!enabled;
  saveSchedules(cwd, schedules);
  return true;
}

export function updateScheduleRunState(cwd, id, { lastRunAt, lastStatus }) {
  const schedules = loadSchedules(cwd);
  const s = schedules.find((x) => x.id === id);
  if (!s) return false;
  if (lastRunAt) s.lastRunAt = lastRunAt;
  if (lastStatus) s.lastStatus = lastStatus;
  saveSchedules(cwd, schedules);
  return true;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Background scheduler that checks schedules every minute and runs due ones.
 * Enforces once-per-minute-per-schedule via `_firedKeys` (schedule.id + minute).
 */
export class CoworkCronScheduler {
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.intervalMs = options.intervalMs || 60_000;
    this.onEvent = options.onEvent || null; // (event) => void
    this._timer = null;
    this._firedKeys = new Set();
    this._running = new Set();
  }

  start() {
    if (this._timer) return;
    this._tick(); // immediate first tick so tests don't wait 60s
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    this._emit({ type: "scheduler-started", intervalMs: this.intervalMs });
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._emit({ type: "scheduler-stopped" });
  }

  _emit(event) {
    if (typeof this.onEvent === "function") {
      try {
        this.onEvent(event);
      } catch (_e) {
        // Never let observer errors break the scheduler
      }
    }
  }

  async _tick() {
    const now = _deps.now();
    const minuteKey = _minuteKey(now);
    let schedules;
    try {
      schedules = loadSchedules(this.cwd);
    } catch (err) {
      this._emit({ type: "load-error", error: err.message });
      return;
    }

    for (const s of schedules) {
      if (!s.enabled) continue;
      const fireKey = `${s.id}:${minuteKey}`;
      if (this._firedKeys.has(fireKey)) continue;
      if (this._running.has(s.id)) continue;
      let isDue = false;
      try {
        isDue = parseCron(s.cron)(now);
      } catch (err) {
        this._emit({ type: "invalid-cron", id: s.id, error: err.message });
        continue;
      }
      if (!isDue) continue;

      this._firedKeys.add(fireKey);
      this._running.add(s.id);
      this._runSchedule(s).finally(() => {
        this._running.delete(s.id);
      });
    }

    // Prevent unbounded growth of _firedKeys — keep only recent minute keys
    if (this._firedKeys.size > 10_000) {
      this._firedKeys.clear();
    }
  }

  async _runSchedule(schedule) {
    const runTask = _deps.runTask;
    if (typeof runTask !== "function") {
      this._emit({
        type: "run-error",
        id: schedule.id,
        error: "runTask not injected",
      });
      return;
    }
    this._emit({
      type: "schedule-fired",
      id: schedule.id,
      cron: schedule.cron,
      templateId: schedule.templateId,
    });
    try {
      const result = await runTask({
        templateId: schedule.templateId,
        userMessage: schedule.userMessage,
        files: schedule.files,
        cwd: this.cwd,
      });
      updateScheduleRunState(this.cwd, schedule.id, {
        lastRunAt: _deps.now().toISOString(),
        lastStatus: result?.status || "completed",
      });
      this._emit({
        type: "schedule-completed",
        id: schedule.id,
        taskId: result?.taskId,
        status: result?.status,
      });
    } catch (err) {
      updateScheduleRunState(this.cwd, schedule.id, {
        lastRunAt: _deps.now().toISOString(),
        lastStatus: "failed",
      });
      this._emit({
        type: "schedule-failed",
        id: schedule.id,
        error: err.message,
      });
    }
  }
}

function _minuteKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}
