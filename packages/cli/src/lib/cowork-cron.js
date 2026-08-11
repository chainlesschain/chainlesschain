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
 * The scheduler ticks every 60s by default. If any schedule uses a 6-field
 * (seconds-aware) cron expression, the tick rate auto-adapts to 1s.
 * Each tick reloads schedules and runs any whose cron matches the current
 * minute (or second, if 6-field). A schedule only runs once per fire-window.
 *
 * Supported cron syntax:
 *   - 5 fields: minute hour dom month dow              (POSIX)
 *   - 6 fields: second minute hour dom month dow       (Quartz-like, seconds first)
 *   - Aliases:  @yearly @annually @monthly @weekly @daily @midnight @hourly
 *
 * @module cowork-cron
 */

import crypto from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { withFileLock } from "./with-file-lock.js";

export const _deps = {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  withFileLock,
  now: () => new Date(),
  runTask: null, // injected at runtime to avoid circular import
};

export const COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT =
  "9999-12-31T23:59:59.999Z";

function coworkSchedulerError(
  code,
  message,
  { retryable = false, retryAt } = {},
) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  if (retryAt !== undefined) error.retryAt = retryAt;
  return error;
}

function normalizedDate(value, label) {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw coworkSchedulerError(
      "COWORK_SCHEDULER_TIME_INVALID",
      `${label} must be a valid date`,
    );
  }
  return date;
}

// ─── Cron parser ─────────────────────────────────────────────────────────────

const FIELD_RANGES = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day-of-month
  [1, 12], // month
  [0, 6], // day-of-week (0=Sun, 6=Sat). 7 also maps to 0.
];

const SECOND_RANGE = [0, 59];

/**
 * Non-standard alias → 5-field expression. Aliases never carry seconds.
 */
export const ALIASES = Object.freeze({
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
});

/**
 * Expand a cron alias (e.g. "@daily") into its 5-field equivalent.
 * Returns the original string unchanged if not an alias.
 */
export function _expandExpr(expr) {
  if (typeof expr !== "string") return expr;
  const trimmed = expr.trim();
  if (trimmed.startsWith("@")) {
    const alias = ALIASES[trimmed.toLowerCase()];
    if (!alias) throw new Error(`unknown cron alias: ${trimmed}`);
    return alias;
  }
  return trimmed;
}

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
 * Parse a 5- or 6-field cron expression (or alias). Returns a match function
 * with `.hasSeconds` boolean property indicating whether the expression
 * carries seconds resolution.
 *
 * @param {string} expr
 * @returns {((date: Date) => boolean) & { hasSeconds: boolean }}
 */
export function parseCron(expr) {
  if (typeof expr !== "string") {
    throw new Error("cron expression must be a string");
  }
  const expanded = _expandExpr(expr);
  const parts = expanded.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new Error(
      `cron must have 5 or 6 fields (got ${parts.length}); use 6-field for seconds resolution or alias like @daily`,
    );
  }
  const hasSeconds = parts.length === 6;
  let second = null;
  let minute, hour, dom, month, dow;
  if (hasSeconds) {
    second = parseCronField(parts[0], SECOND_RANGE);
    [minute, hour, dom, month, dow] = parts
      .slice(1)
      .map((p, i) => parseCronField(p, FIELD_RANGES[i]));
  } else {
    [minute, hour, dom, month, dow] = parts.map((p, i) =>
      parseCronField(p, FIELD_RANGES[i]),
    );
  }

  // Pre-compute restriction flags for POSIX dom/dow OR-semantics
  const domField = hasSeconds ? parts[3] : parts[2];
  const dowField = hasSeconds ? parts[5] : parts[4];
  const domRestricted = domField !== "*";
  const dowRestricted = dowField !== "*";

  function matches(date) {
    const s = date.getSeconds();
    const m = date.getMinutes();
    const h = date.getHours();
    const D = date.getDate();
    const M = date.getMonth() + 1; // JS month is 0-based
    const W = date.getDay();
    if (hasSeconds && !second.has(s)) return false;
    if (!minute.has(m)) return false;
    if (!hour.has(h)) return false;
    if (!month.has(M)) return false;
    // POSIX: if both dom and dow are restricted (not *), match is OR.
    if (domRestricted && dowRestricted) {
      return dom.has(D) || dow.has(W);
    }
    if (domRestricted) return dom.has(D);
    if (dowRestricted) return dow.has(W);
    return true;
  }
  matches.hasSeconds = hasSeconds;
  return matches;
}

/** Returns true if the cron expression carries seconds resolution. */
export function hasSecondsResolution(expr) {
  try {
    return parseCron(expr).hasSeconds;
  } catch (_e) {
    return false;
  }
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
export function loadSchedules(cwd, { failOnMalformed = false } = {}) {
  const file = _scheduleFile(cwd);
  if (!_deps.existsSync(file)) return [];
  const raw = _deps.readFileSync(file, "utf-8");
  const out = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch (cause) {
      if (failOnMalformed) {
        const error = new Error(
          `cowork schedule store contains malformed JSON: ${file}`,
          { cause },
        );
        error.code = "COWORK_SCHEDULE_STORE_CORRUPT";
        throw error;
      }
      // Advisory readers can still display the remaining valid records.
    }
  }
  return out;
}

function _prepareScheduleDir(cwd) {
  const dir = join(cwd, ".chainlesschain", "cowork");
  _deps.mkdirSync(dir, { recursive: true });
  return dir;
}

function _saveSchedulesUnlocked(cwd, schedules) {
  _prepareScheduleDir(cwd);
  const file = _scheduleFile(cwd);
  const body = schedules.map((s) => JSON.stringify(s)).join("\n");
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    _deps.writeFileSync(tmp, body ? body + "\n" : "", "utf-8");
    _deps.renameSync(tmp, file);
  } catch (error) {
    try {
      _deps.unlinkSync(tmp);
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  }
}

function _withScheduleLock(cwd, body) {
  _prepareScheduleDir(cwd);
  return _deps.withFileLock(_scheduleFile(cwd), body, {
    failIfUnavailable: true,
  });
}

/** Atomically replace the full schedule list under a fail-closed lock. */
export function saveSchedules(cwd, schedules) {
  return _withScheduleLock(cwd, () => _saveSchedulesUnlocked(cwd, schedules));
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function addSchedule(cwd, input) {
  const { cron, templateId = null, userMessage, files = [] } = input || {};
  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }
  const err = validateCron(cron);
  if (err) throw new Error(`invalid cron: ${err}`);

  // Serialize the read-modify-write across processes (cc+cc / cc+desktop share
  // the cowork dir) so concurrently-added schedules don't clobber each other.
  return _withScheduleLock(cwd, () => {
    const schedules = loadSchedules(cwd, { failOnMalformed: true });
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
    _saveSchedulesUnlocked(cwd, schedules);
    return entry;
  });
}

export function removeSchedule(cwd, id) {
  return _withScheduleLock(cwd, () => {
    const schedules = loadSchedules(cwd, { failOnMalformed: true });
    const idx = schedules.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    schedules.splice(idx, 1);
    _saveSchedulesUnlocked(cwd, schedules);
    return true;
  });
}

export function setScheduleEnabled(cwd, id, enabled) {
  return _withScheduleLock(cwd, () => {
    const schedules = loadSchedules(cwd, { failOnMalformed: true });
    const s = schedules.find((x) => x.id === id);
    if (!s) return false;
    s.enabled = !!enabled;
    _saveSchedulesUnlocked(cwd, schedules);
    return true;
  });
}

export function updateScheduleRunState(cwd, id, { lastRunAt, lastStatus }) {
  return _withScheduleLock(cwd, () => {
    const schedules = loadSchedules(cwd, { failOnMalformed: true });
    const s = schedules.find((x) => x.id === id);
    if (!s) return false;
    if (lastRunAt) s.lastRunAt = lastRunAt;
    if (lastStatus) s.lastStatus = lastStatus;
    _saveSchedulesUnlocked(cwd, schedules);
    return true;
  });
}

/** Return one schedule by id, or null when it does not exist. */
export function getSchedule(cwd, id) {
  if (typeof id !== "string" || id.length === 0) return null;
  return (
    loadSchedules(cwd, { failOnMalformed: true }).find(
      (schedule) => schedule.id === id,
    ) || null
  );
}

/**
 * Bind a scheduler-kernel occurrence before starting the Cowork task.
 * The same JSONL lock used by the legacy driver closes both old-first and
 * new-first claim races during migration.
 */
export function bindSchedulerScheduleFire(
  cwd,
  id,
  { deliveryId, occurrenceId, snapshotDigest, attempt, at = _deps.now() } = {},
) {
  if (
    typeof deliveryId !== "string" ||
    typeof occurrenceId !== "string" ||
    typeof snapshotDigest !== "string" ||
    deliveryId.length === 0 ||
    occurrenceId.length === 0 ||
    snapshotDigest.length === 0 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  ) {
    throw coworkSchedulerError(
      "COWORK_SCHEDULER_BINDING_INVALID",
      "Cowork scheduler binding requires deliveryId, occurrenceId, snapshotDigest, and a positive attempt",
    );
  }
  const now = normalizedDate(at, "cowork scheduler binding time");
  const nowMs = now.getTime();
  return _withScheduleLock(cwd, () => {
    const schedules = loadSchedules(cwd, { failOnMalformed: true });
    const schedule = schedules.find((entry) => entry.id === id);
    if (!schedule) {
      throw coworkSchedulerError(
        "COWORK_SCHEDULER_SCHEDULE_NOT_FOUND",
        `Cowork schedule does not exist: ${id}`,
      );
    }
    const prior = schedule.schedulerExecution;
    if (prior?.status === "running") {
      throw coworkSchedulerError(
        "COWORK_SCHEDULER_OUTCOME_UNKNOWN",
        `Cowork schedule outcome is unknown: ${id}`,
      );
    }
    if (
      prior?.status === "succeeded" &&
      prior.occurrenceId === occurrenceId &&
      prior.snapshotDigest === snapshotDigest
    ) {
      return schedule;
    }
    // A legacy runner may have completed after the kernel enqueued this fire
    // but before it acquired the JSONL lock. Its durable delivery id is
    // terminal evidence for the same logical fire, so never overwrite it with
    // a new scheduler claim.
    if (schedule.lastDeliveryId === deliveryId) return schedule;

    const active = schedule.activeDelivery;
    const activeExpiresAt = Date.parse(active?.leaseExpiresAt || "");
    if (active && Number.isFinite(activeExpiresAt) && activeExpiresAt > nowMs) {
      throw coworkSchedulerError(
        "COWORK_SCHEDULER_LEGACY_CLAIM_ACTIVE",
        `Cowork schedule is already claimed: ${id}`,
        { retryable: true, retryAt: activeExpiresAt },
      );
    }

    const fence =
      Math.max(
        Number(schedule.deliveryFence) || 0,
        Number(active?.fence) || 0,
      ) + 1;
    schedule.deliveryFence = fence;
    schedule.activeDelivery = {
      deliveryId,
      ownerId: `scheduler:${occurrenceId}:${attempt}`,
      fence,
      claimedAt: now.toISOString(),
      leaseExpiresAt: COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
    };
    schedule.schedulerExecution = {
      deliveryId,
      occurrenceId,
      snapshotDigest,
      attempt,
      status: "running",
      startedAt: now.toISOString(),
    };
    _saveSchedulesUnlocked(cwd, schedules);
    return schedule;
  });
}

/**
 * Atomically settle scheduler evidence and the legacy Cowork delivery state.
 * A known failure may keep a short legacy-visible fence until retryAt; an
 * unknown outcome never calls this function and therefore remains fenced.
 */
export function completeSchedulerScheduleFire(
  cwd,
  id,
  {
    deliveryId,
    occurrenceId,
    snapshotDigest,
    attempt,
    outcome,
    result = null,
    error = null,
    retryAt,
    at = _deps.now(),
  } = {},
) {
  if (!["succeeded", "failed"].includes(outcome)) {
    throw coworkSchedulerError(
      "COWORK_SCHEDULER_OUTCOME_INVALID",
      "Cowork scheduler outcome must be succeeded or failed",
    );
  }
  const now = normalizedDate(at, "cowork scheduler completion time");
  const retryAtMs =
    retryAt === undefined || retryAt === null ? null : Number(retryAt);
  if (retryAtMs !== null && !Number.isSafeInteger(retryAtMs)) {
    throw coworkSchedulerError(
      "COWORK_SCHEDULER_RETRY_TIME_INVALID",
      "Cowork scheduler retryAt must be a safe epoch millisecond",
    );
  }
  return _withScheduleLock(cwd, () => {
    const schedules = loadSchedules(cwd, { failOnMalformed: true });
    const schedule = schedules.find((entry) => entry.id === id);
    if (!schedule) {
      throw coworkSchedulerError(
        "COWORK_SCHEDULER_SCHEDULE_NOT_FOUND",
        `Cowork schedule does not exist: ${id}`,
      );
    }
    const evidence = schedule.schedulerExecution;
    if (
      !evidence ||
      evidence.deliveryId !== deliveryId ||
      evidence.occurrenceId !== occurrenceId ||
      evidence.snapshotDigest !== snapshotDigest ||
      evidence.attempt !== attempt ||
      evidence.status !== "running"
    ) {
      throw coworkSchedulerError(
        "COWORK_SCHEDULER_BINDING_MISMATCH",
        `Cowork scheduler evidence does not match the active claim: ${id}`,
      );
    }

    schedule.schedulerExecution = {
      ...evidence,
      status: outcome,
      endedAt: now.toISOString(),
      ...(outcome === "succeeded" ? { result } : { error }),
    };
    if (outcome === "succeeded") {
      schedule.lastDeliveryId = deliveryId;
      schedule.lastRunAt = now.toISOString();
      schedule.lastStatus = result?.status || "completed";
      schedule.activeDelivery = null;
    } else if (retryAtMs !== null && retryAtMs > now.getTime()) {
      schedule.activeDelivery = {
        ...schedule.activeDelivery,
        leaseExpiresAt: new Date(retryAtMs).toISOString(),
      };
    } else {
      schedule.activeDelivery = null;
    }
    _saveSchedulesUnlocked(cwd, schedules);
    return schedule;
  });
}

/**
 * Claim one concrete cron fire before launching its side effect. The persisted
 * delivery id prevents two scheduler processes from running the same fire; an
 * expired claim can be recovered after a crashed owner.
 */
export function claimScheduleFire(
  cwd,
  id,
  deliveryId,
  { ownerId, now = _deps.now(), leaseMs = 120_000 } = {},
) {
  if (!ownerId || !deliveryId) {
    throw new Error("claimScheduleFire requires ownerId and deliveryId");
  }
  return _withScheduleLock(cwd, () => {
    const schedules = loadSchedules(cwd, { failOnMalformed: true });
    const schedule = schedules.find((entry) => entry.id === id);
    if (!schedule) return null;
    if (schedule.lastDeliveryId === deliveryId) return null;

    const nowMs = now.getTime();
    const active = schedule.activeDelivery;
    const expiresAt = Date.parse(active?.leaseExpiresAt || "");
    if (active && Number.isFinite(expiresAt) && expiresAt > nowMs) {
      return null;
    }

    const fence =
      Math.max(
        Number(schedule.deliveryFence) || 0,
        Number(active?.fence) || 0,
      ) + 1;
    const claim = {
      deliveryId,
      ownerId,
      fence,
      claimedAt: now.toISOString(),
      leaseExpiresAt: new Date(nowMs + Math.max(1000, leaseMs)).toISOString(),
    };
    schedule.deliveryFence = fence;
    schedule.activeDelivery = claim;
    _saveSchedulesUnlocked(cwd, schedules);
    return { ...claim };
  });
}

/** Renew a live claim. A stale owner can never renew after its fence is stolen. */
export function renewScheduleFire(
  cwd,
  id,
  claim,
  { now = _deps.now(), leaseMs = 120_000 } = {},
) {
  return _withScheduleLock(cwd, () => {
    const schedules = loadSchedules(cwd, { failOnMalformed: true });
    const schedule = schedules.find((entry) => entry.id === id);
    const active = schedule?.activeDelivery;
    if (
      !active ||
      active.deliveryId !== claim?.deliveryId ||
      active.ownerId !== claim?.ownerId ||
      active.fence !== claim?.fence
    ) {
      return false;
    }
    active.leaseExpiresAt = new Date(
      now.getTime() + Math.max(1000, leaseMs),
    ).toISOString();
    _saveSchedulesUnlocked(cwd, schedules);
    return true;
  });
}

/**
 * Commit the delivery outcome only when the owner/fence still matches. This is
 * the scheduler equivalent of compare-and-swap: a late crashed owner cannot
 * overwrite the successor's task state.
 */
export function settleScheduleFire(
  cwd,
  id,
  claim,
  { lastRunAt, lastStatus } = {},
) {
  return _withScheduleLock(cwd, () => {
    const schedules = loadSchedules(cwd, { failOnMalformed: true });
    const schedule = schedules.find((entry) => entry.id === id);
    const active = schedule?.activeDelivery;
    if (
      !active ||
      active.deliveryId !== claim?.deliveryId ||
      active.ownerId !== claim?.ownerId ||
      active.fence !== claim?.fence
    ) {
      return false;
    }
    schedule.lastDeliveryId = claim.deliveryId;
    schedule.lastRunAt = lastRunAt || _deps.now().toISOString();
    schedule.lastStatus = lastStatus || "completed";
    schedule.activeDelivery = null;
    _saveSchedulesUnlocked(cwd, schedules);
    return true;
  });
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Background scheduler that checks schedules every minute and runs due ones.
 * Enforces once-per-minute-per-schedule via `_firedKeys` (schedule.id + minute).
 */
export class CoworkCronScheduler {
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    // If caller pins intervalMs we honor it; else auto-adapt based on schedules.
    this._intervalPinned = typeof options.intervalMs === "number";
    this.intervalMs = options.intervalMs || 60_000;
    this.onEvent = options.onEvent || null; // (event) => void
    this.ownerId =
      options.ownerId ||
      `cowork-cron:${process.pid}:${crypto.randomUUID().slice(0, 12)}`;
    this.leaseMs = Math.max(1000, Number(options.leaseMs) || 120_000);
    this._timer = null;
    this._firedKeys = new Set();
    this._running = new Set();
  }

  start() {
    if (this._timer) return;
    this._adaptInterval(); // pick 1s vs 60s based on current schedules
    this._tick(); // immediate first tick so tests don't wait
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    this._emit({ type: "scheduler-started", intervalMs: this.intervalMs });
  }

  /**
   * Re-evaluate desired tick rate. If any active schedule uses seconds, drop
   * to 1s; else use 60s. No-op if caller pinned intervalMs.
   */
  _adaptInterval() {
    if (this._intervalPinned) return;
    let schedules = [];
    try {
      schedules = loadSchedules(this.cwd);
    } catch (_e) {
      // ignore — keep current interval
    }
    const wantSeconds = schedules.some(
      (s) => s.enabled !== false && hasSecondsResolution(s.cron),
    );
    const desired = wantSeconds ? 1000 : 60_000;
    if (desired !== this.intervalMs) {
      this.intervalMs = desired;
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = setInterval(() => this._tick(), this.intervalMs);
        this._emit({ type: "scheduler-retuned", intervalMs: this.intervalMs });
      }
    }
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
    let schedules;
    try {
      schedules = loadSchedules(this.cwd);
    } catch (err) {
      this._emit({ type: "load-error", error: err.message });
      return;
    }

    // Re-adapt interval if schedule set changed (added/removed seconds-aware)
    this._adaptInterval();

    for (const s of schedules) {
      if (!s.enabled) continue;
      let matcher;
      try {
        matcher = parseCron(s.cron);
      } catch (err) {
        this._emit({ type: "invalid-cron", id: s.id, error: err.message });
        continue;
      }
      const fireKey = coworkCronFireKey(s, now);
      if (this._firedKeys.has(fireKey)) continue;
      if (this._running.has(s.id)) continue;
      const isDue = matcher(now);
      if (!isDue) continue;

      let claim;
      try {
        claim = claimScheduleFire(this.cwd, s.id, fireKey, {
          ownerId: this.ownerId,
          now,
          leaseMs: this.leaseMs,
        });
      } catch (err) {
        this._emit({
          type: "schedule-claim-failed",
          id: s.id,
          deliveryId: fireKey,
          error: err.message,
        });
        continue;
      }

      this._firedKeys.add(fireKey);
      if (!claim) continue;
      this._running.add(s.id);
      this._runSchedule(s, claim).finally(() => {
        this._running.delete(s.id);
      });
    }

    // Prevent unbounded growth of _firedKeys — keep only recent minute keys
    if (this._firedKeys.size > 10_000) {
      this._firedKeys.clear();
    }
  }

  async _runSchedule(schedule, claim) {
    const runTask = _deps.runTask;
    if (typeof runTask !== "function") {
      try {
        settleScheduleFire(this.cwd, schedule.id, claim, {
          lastStatus: "failed",
        });
      } catch (err) {
        this._emit({
          type: "schedule-settlement-failed",
          id: schedule.id,
          deliveryId: claim.deliveryId,
          error: err.message,
        });
      }
      this._emit({
        type: "run-error",
        id: schedule.id,
        deliveryId: claim.deliveryId,
        error: "runTask not injected",
      });
      return;
    }
    this._emit({
      type: "schedule-fired",
      id: schedule.id,
      cron: schedule.cron,
      templateId: schedule.templateId,
      deliveryId: claim.deliveryId,
    });

    const renewal = setInterval(
      () => {
        try {
          const renewed = renewScheduleFire(this.cwd, schedule.id, claim, {
            leaseMs: this.leaseMs,
          });
          if (!renewed) {
            this._emit({
              type: "schedule-lease-lost",
              id: schedule.id,
              deliveryId: claim.deliveryId,
            });
          }
        } catch (err) {
          this._emit({
            type: "schedule-lease-renewal-failed",
            id: schedule.id,
            deliveryId: claim.deliveryId,
            error: err.message,
          });
        }
      },
      Math.max(1000, Math.floor(this.leaseMs / 3)),
    );
    renewal.unref?.();

    let result = null;
    let failure = null;
    try {
      result = await runTask({
        templateId: schedule.templateId,
        userMessage: schedule.userMessage,
        files: schedule.files,
        cwd: this.cwd,
        scheduleId: schedule.id,
        deliveryId: claim.deliveryId,
      });
    } catch (err) {
      failure = err;
    } finally {
      clearInterval(renewal);
    }

    let settled;
    try {
      settled = settleScheduleFire(this.cwd, schedule.id, claim, {
        lastRunAt: _deps.now().toISOString(),
        lastStatus: failure ? "failed" : result?.status || "completed",
      });
    } catch (err) {
      this._emit({
        type: "schedule-settlement-failed",
        id: schedule.id,
        deliveryId: claim.deliveryId,
        error: err.message,
      });
      return;
    }
    if (!settled) {
      this._emit({
        type: "schedule-settlement-rejected",
        id: schedule.id,
        deliveryId: claim.deliveryId,
      });
      return;
    }

    if (failure) {
      this._emit({
        type: "schedule-failed",
        id: schedule.id,
        deliveryId: claim.deliveryId,
        error: failure.message,
      });
      return;
    }

    this._emit({
      type: "schedule-completed",
      id: schedule.id,
      deliveryId: claim.deliveryId,
      taskId: result?.taskId,
      status: result?.status,
    });
  }
}

export function coworkCronMinuteKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

export function coworkCronSecondKey(date) {
  return `${coworkCronMinuteKey(date)}-${date.getSeconds()}`;
}

export function coworkCronFireKey(schedule, date) {
  const matcher = parseCron(schedule.cron);
  return `${schedule.id}:${
    matcher.hasSeconds ? coworkCronSecondKey(date) : coworkCronMinuteKey(date)
  }`;
}

// =====================================================================
// Cowork Cron V2 governance overlay
// =====================================================================
export const CCRON_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const CCRON_TICK_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _ccronPTrans = new Map([
  [
    CCRON_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CCRON_PROFILE_MATURITY_V2.ACTIVE,
      CCRON_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CCRON_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CCRON_PROFILE_MATURITY_V2.PAUSED,
      CCRON_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CCRON_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      CCRON_PROFILE_MATURITY_V2.ACTIVE,
      CCRON_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CCRON_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _ccronPTerminal = new Set([CCRON_PROFILE_MATURITY_V2.ARCHIVED]);
const _ccronTTrans = new Map([
  [
    CCRON_TICK_LIFECYCLE_V2.QUEUED,
    new Set([
      CCRON_TICK_LIFECYCLE_V2.RUNNING,
      CCRON_TICK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CCRON_TICK_LIFECYCLE_V2.RUNNING,
    new Set([
      CCRON_TICK_LIFECYCLE_V2.COMPLETED,
      CCRON_TICK_LIFECYCLE_V2.FAILED,
      CCRON_TICK_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CCRON_TICK_LIFECYCLE_V2.COMPLETED, new Set()],
  [CCRON_TICK_LIFECYCLE_V2.FAILED, new Set()],
  [CCRON_TICK_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _ccronPsV2 = new Map();
const _ccronTsV2 = new Map();
let _ccronMaxActive = 6,
  _ccronMaxPending = 15,
  _ccronIdleMs = 30 * 24 * 60 * 60 * 1000,
  _ccronStuckMs = 60 * 1000;
function _ccronPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _ccronCheckP(from, to) {
  const a = _ccronPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ccron profile transition ${from} → ${to}`);
}
function _ccronCheckT(from, to) {
  const a = _ccronTTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ccron tick transition ${from} → ${to}`);
}
function _ccronCountActive(owner) {
  let c = 0;
  for (const p of _ccronPsV2.values())
    if (p.owner === owner && p.status === CCRON_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _ccronCountPending(profileId) {
  let c = 0;
  for (const t of _ccronTsV2.values())
    if (
      t.profileId === profileId &&
      (t.status === CCRON_TICK_LIFECYCLE_V2.QUEUED ||
        t.status === CCRON_TICK_LIFECYCLE_V2.RUNNING)
    )
      c++;
  return c;
}
export function setMaxActiveCcronProfilesPerOwnerV2(n) {
  _ccronMaxActive = _ccronPos(n, "maxActiveCcronProfilesPerOwner");
}
export function getMaxActiveCcronProfilesPerOwnerV2() {
  return _ccronMaxActive;
}
export function setMaxPendingCcronTicksPerProfileV2(n) {
  _ccronMaxPending = _ccronPos(n, "maxPendingCcronTicksPerProfile");
}
export function getMaxPendingCcronTicksPerProfileV2() {
  return _ccronMaxPending;
}
export function setCcronProfileIdleMsV2(n) {
  _ccronIdleMs = _ccronPos(n, "ccronProfileIdleMs");
}
export function getCcronProfileIdleMsV2() {
  return _ccronIdleMs;
}
export function setCcronTickStuckMsV2(n) {
  _ccronStuckMs = _ccronPos(n, "ccronTickStuckMs");
}
export function getCcronTickStuckMsV2() {
  return _ccronStuckMs;
}
export function _resetStateCoworkCronV2() {
  _ccronPsV2.clear();
  _ccronTsV2.clear();
  _ccronMaxActive = 6;
  _ccronMaxPending = 15;
  _ccronIdleMs = 30 * 24 * 60 * 60 * 1000;
  _ccronStuckMs = 60 * 1000;
}
export function registerCcronProfileV2({ id, owner, expr, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_ccronPsV2.has(id)) throw new Error(`ccron profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    expr: expr || "0 0 * * *",
    status: CCRON_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ccronPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCcronProfileV2(id) {
  const p = _ccronPsV2.get(id);
  if (!p) throw new Error(`ccron profile ${id} not found`);
  const isInitial = p.status === CCRON_PROFILE_MATURITY_V2.PENDING;
  _ccronCheckP(p.status, CCRON_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _ccronCountActive(p.owner) >= _ccronMaxActive)
    throw new Error(`max active ccron profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CCRON_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseCcronProfileV2(id) {
  const p = _ccronPsV2.get(id);
  if (!p) throw new Error(`ccron profile ${id} not found`);
  _ccronCheckP(p.status, CCRON_PROFILE_MATURITY_V2.PAUSED);
  p.status = CCRON_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCcronProfileV2(id) {
  const p = _ccronPsV2.get(id);
  if (!p) throw new Error(`ccron profile ${id} not found`);
  _ccronCheckP(p.status, CCRON_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CCRON_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCcronProfileV2(id) {
  const p = _ccronPsV2.get(id);
  if (!p) throw new Error(`ccron profile ${id} not found`);
  if (_ccronPTerminal.has(p.status))
    throw new Error(`cannot touch terminal ccron profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCcronProfileV2(id) {
  const p = _ccronPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCcronProfilesV2() {
  return [..._ccronPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCcronTickV2({ id, profileId, tickAt, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_ccronTsV2.has(id)) throw new Error(`ccron tick ${id} already exists`);
  if (!_ccronPsV2.has(profileId))
    throw new Error(`ccron profile ${profileId} not found`);
  if (_ccronCountPending(profileId) >= _ccronMaxPending)
    throw new Error(`max pending ccron ticks for profile ${profileId} reached`);
  const now = Date.now();
  const t = {
    id,
    profileId,
    tickAt: tickAt || now,
    status: CCRON_TICK_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ccronTsV2.set(id, t);
  return { ...t, metadata: { ...t.metadata } };
}
export function runningCcronTickV2(id) {
  const t = _ccronTsV2.get(id);
  if (!t) throw new Error(`ccron tick ${id} not found`);
  _ccronCheckT(t.status, CCRON_TICK_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  t.status = CCRON_TICK_LIFECYCLE_V2.RUNNING;
  t.updatedAt = now;
  if (!t.startedAt) t.startedAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function completeCcronTickV2(id) {
  const t = _ccronTsV2.get(id);
  if (!t) throw new Error(`ccron tick ${id} not found`);
  _ccronCheckT(t.status, CCRON_TICK_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  t.status = CCRON_TICK_LIFECYCLE_V2.COMPLETED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function failCcronTickV2(id, reason) {
  const t = _ccronTsV2.get(id);
  if (!t) throw new Error(`ccron tick ${id} not found`);
  _ccronCheckT(t.status, CCRON_TICK_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  t.status = CCRON_TICK_LIFECYCLE_V2.FAILED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  if (reason) t.metadata.failReason = String(reason);
  return { ...t, metadata: { ...t.metadata } };
}
export function cancelCcronTickV2(id, reason) {
  const t = _ccronTsV2.get(id);
  if (!t) throw new Error(`ccron tick ${id} not found`);
  _ccronCheckT(t.status, CCRON_TICK_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  t.status = CCRON_TICK_LIFECYCLE_V2.CANCELLED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  if (reason) t.metadata.cancelReason = String(reason);
  return { ...t, metadata: { ...t.metadata } };
}
export function getCcronTickV2(id) {
  const t = _ccronTsV2.get(id);
  if (!t) return null;
  return { ...t, metadata: { ...t.metadata } };
}
export function listCcronTicksV2() {
  return [..._ccronTsV2.values()].map((t) => ({
    ...t,
    metadata: { ...t.metadata },
  }));
}
export function autoPauseIdleCcronProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _ccronPsV2.values())
    if (
      p.status === CCRON_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _ccronIdleMs
    ) {
      p.status = CCRON_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCcronTicksV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const x of _ccronTsV2.values())
    if (
      x.status === CCRON_TICK_LIFECYCLE_V2.RUNNING &&
      x.startedAt != null &&
      t - x.startedAt >= _ccronStuckMs
    ) {
      x.status = CCRON_TICK_LIFECYCLE_V2.FAILED;
      x.updatedAt = t;
      if (!x.settledAt) x.settledAt = t;
      x.metadata.failReason = "auto-fail-stuck";
      flipped.push(x.id);
    }
  return { flipped, count: flipped.length };
}
export function getCoworkCronGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CCRON_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _ccronPsV2.values()) profilesByStatus[p.status]++;
  const ticksByStatus = {};
  for (const v of Object.values(CCRON_TICK_LIFECYCLE_V2)) ticksByStatus[v] = 0;
  for (const t of _ccronTsV2.values()) ticksByStatus[t.status]++;
  return {
    totalCcronProfilesV2: _ccronPsV2.size,
    totalCcronTicksV2: _ccronTsV2.size,
    maxActiveCcronProfilesPerOwner: _ccronMaxActive,
    maxPendingCcronTicksPerProfile: _ccronMaxPending,
    ccronProfileIdleMs: _ccronIdleMs,
    ccronTickStuckMs: _ccronStuckMs,
    profilesByStatus,
    ticksByStatus,
  };
}
