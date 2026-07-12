/**
 * Pure scheduling planner for the agent Scheduler / Monitor (P1 §"统一持久
 * Scheduler、Monitor 和 Channel").
 *
 * The persisted store ([[agent-schedule-store.js]]) already guarantees the
 * catch-up invariant — a cron down for N periods fires ONCE, not N times,
 * because `advanceCron` jumps to `nextCronTime(now)` rather than stepping
 * through every miss. This module adds the pieces a unified daemon event
 * runtime still needs, all as PURE, clock-injected functions (no timers, no
 * RNG, deterministic across restarts):
 *
 *   - **deterministic jitter** — spread tasks that share a cron minute (e.g.
 *     every `0 * * * *`) by a STABLE per-task offset, so a shared tick is not a
 *     thundering herd. The offset is a hash of the task id, so it never moves
 *     across a restart (an RNG offset would, defeating the point).
 *   - **adaptive next-wakeup** — the earliest future fire time, so a daemon
 *     sleeps until then instead of polling.
 *   - **expiry** — a task past `expiresAt` retires without a final fire.
 *
 * A daemon uses `partitionSchedule` (retire expired, fire due) then
 * `msUntilNextWakeup` (sleep precisely). `jitterMs = 0` (the default) makes the
 * due set byte-identical to the store's existing `due()`.
 */

// FNV-1a → a stable 32-bit hash. Deterministic and dependency-free, so the same
// task always draws the same jitter offset (across processes and restarts).
function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A stable jitter offset in `[0, jitterMs)` derived from the task id. Same id +
 * same jitterMs → same offset, every time. `jitterMs <= 0` → no jitter (0).
 */
export function jitterOffsetMs(id, jitterMs) {
  const j = Math.floor(Number(jitterMs) || 0);
  if (j <= 0) return 0;
  return hash32(id) % j;
}

/** The entry's base fire time: `dueAt` for a wakeup, `nextAt` otherwise. */
export function baseFireAt(entry) {
  if (!entry) return null;
  const raw = entry.kind === "wakeup" ? entry.dueAt : entry.nextAt;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Base fire time with the entry's deterministic jitter applied. */
export function effectiveFireAt(entry, jitterMs = 0) {
  const base = baseFireAt(entry);
  if (base == null) return null;
  return base + jitterOffsetMs(entry?.id, jitterMs);
}

/** Is an entry still pending/active (not in a terminal state)? */
export function isSchedulable(entry) {
  if (!entry) return false;
  if (entry.kind === "wakeup") return entry.status === "pending";
  return entry.status === "active";
}

/**
 * Expiry: a task with an `expiresAt` at or before `now` is retired regardless
 * of its schedule. A missing / non-positive `expiresAt` never expires.
 */
export function isEntryExpired(entry, now) {
  const exp = Number(entry?.expiresAt);
  return Number.isFinite(exp) && exp > 0 && exp <= Number(now);
}

/**
 * Partition schedulable entries at `now` into what a daemon should do:
 *   - `expired` — retire (status → expired). Checked BEFORE due so an expired
 *     task never gets a final fire.
 *   - `due` — fire now (jittered fire time has arrived).
 *   - `waiting` — still pending.
 * Terminal entries are skipped entirely.
 */
export function partitionSchedule(entries, { now, jitterMs = 0 } = {}) {
  const t = Number(now);
  const expired = [];
  const due = [];
  const waiting = [];
  for (const entry of entries || []) {
    if (!isSchedulable(entry)) continue;
    if (isEntryExpired(entry, t)) {
      expired.push(entry);
      continue;
    }
    const fireAt = effectiveFireAt(entry, jitterMs);
    if (fireAt != null && fireAt <= t) due.push(entry);
    else waiting.push(entry);
  }
  return { expired, due, waiting };
}

/**
 * The earliest future jittered fire time among schedulable, non-expired
 * entries — what a daemon sleeps until (adaptive wakeup). An already-due entry
 * contributes `now` (fire immediately). Returns null when nothing is scheduled.
 */
export function nextWakeupAt(entries, { now, jitterMs = 0 } = {}) {
  const t = Number(now);
  let min = null;
  for (const entry of entries || []) {
    if (!isSchedulable(entry) || isEntryExpired(entry, t)) continue;
    const fireAt = effectiveFireAt(entry, jitterMs);
    if (fireAt == null) continue;
    const at = fireAt <= t ? t : fireAt;
    if (min == null || at < min) min = at;
  }
  return min;
}

/**
 * Milliseconds until the next wakeup, clamped to `[0, maxMs]` (a cap keeps a
 * far-future task from parking the daemon forever — it re-checks by `maxMs`).
 * null when nothing is scheduled.
 */
export function msUntilNextWakeup(
  entries,
  { now, jitterMs = 0, maxMs = null } = {},
) {
  const at = nextWakeupAt(entries, { now, jitterMs });
  if (at == null) return null;
  let ms = Math.max(0, at - Number(now));
  if (maxMs != null && Number.isFinite(maxMs)) ms = Math.min(ms, Number(maxMs));
  return ms;
}
