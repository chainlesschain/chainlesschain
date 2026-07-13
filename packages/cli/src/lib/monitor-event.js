/**
 * Monitor event envelope + delivery guards (P1 daemon Event Runtime —
 * CLAUDE_CODE_CLI_INCREMENTAL_GAP_ANALYSIS_2026-07-12 §"守护进程事件运行时闭环").
 *
 * A Monitor watches a source (command stdout, file change, URL body, …) and
 * "fires" when its condition matches. Before that firing reaches the agent as a
 * turn it needs the same delivery guarantees Claude Code gives scheduled/event
 * tasks:
 *
 *   - **event_id** — a *deterministic* identity (no RNG) derived from the
 *     monitor id + the observation, so the same observation across a daemon
 *     restart hashes to the same id and can be de-duplicated.
 *   - **dedup window** — a time+count bounded set of recently-seen ids so a
 *     monitor that matches every poll does not re-fire the identical event.
 *   - **size cap** — oversized payloads are truncated (with a flag) so a
 *     runaway command output cannot blow up a turn / the audit log.
 *   - **backpressure** — a bounded queue that drops (and counts) events rather
 *     than growing without limit when the agent is slower than the source.
 *   - **authority** — a monitor event is an internal SYSTEM event: it tops out
 *     at `steer` (agent-authority.js) and can NEVER answer a permission gate.
 *
 * Pure + dependency-light (node:crypto + agent-authority.js) so any monitor
 * firing seam — daemon runtime, `cc agenda run`, a future in-process runtime —
 * can share exactly one implementation of these invariants.
 */

import { createHash } from "node:crypto";
import {
  ORIGIN,
  authorityForOrigin,
  canApprove,
  describeAuthorityChain,
} from "./agent-authority.js";

/** Default per-event payload cap (64 KiB) — matches the schedule store's audit budget. */
export const DEFAULT_MAX_EVENT_BYTES = 64 * 1024;

/** Default dedup window: an id seen within 5 minutes (or the last 1000 ids) is a repeat. */
export const DEFAULT_DEDUP_WINDOW_MS = 5 * 60 * 1000;
export const DEFAULT_DEDUP_MAX_ENTRIES = 1000;

/** Default bounded queue depth before backpressure drops kick in. */
export const DEFAULT_QUEUE_MAX_SIZE = 256;

/**
 * A stable string form of an observation so structurally-equal observations
 * hash identically and any real change hashes differently. Mirrors
 * agent-authority's `normalizeToolArgs` intent (key-order independent).
 */
function stablePayload(payload) {
  return stableStringify(payload === undefined ? null : payload);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
      .join(",") +
    "}"
  );
}

/**
 * Deterministic event id for a monitor observation. Same `(monitorId, payload)`
 * → same id, forever, with no RNG — so a daemon restart re-observing the same
 * thing is recognised as a repeat instead of re-firing.
 */
export function monitorEventId(monitorId, payload) {
  const h = createHash("sha256");
  h.update("cc-monitor-event-v1\n");
  h.update(String(monitorId ?? "") + "\n");
  h.update(stablePayload(payload) + "\n");
  return "ev_" + h.digest("hex").slice(0, 24);
}

/**
 * Cap a payload's serialized size. Returns `{ value, truncated, bytes }`.
 * Strings are truncated by UTF-8 byte length; non-strings are JSON-serialized,
 * and if the JSON is over budget the *serialized string* is truncated and
 * returned (so the event still carries a bounded, human-readable snippet rather
 * than an unbounded object).
 */
export function capEventPayload(payload, maxBytes = DEFAULT_MAX_EVENT_BYTES) {
  const limit = Math.max(0, Number(maxBytes) || 0);
  const asString =
    typeof payload === "string" ? payload : safeJsonStringify(payload);
  const bytes = Buffer.byteLength(asString, "utf8");
  if (limit === 0 || bytes <= limit) {
    return { value: payload, truncated: false, bytes };
  }
  const truncated = truncateUtf8(asString, limit);
  return {
    value: truncated,
    truncated: true,
    bytes: Buffer.byteLength(truncated, "utf8"),
  };
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value === undefined ? null : value);
  } catch {
    return String(value);
  }
}

/** Truncate a string to at most `maxBytes` UTF-8 bytes without splitting a code point. */
function truncateUtf8(str, maxBytes) {
  const buf = Buffer.from(str, "utf8");
  if (buf.length <= maxBytes) return str;
  let end = maxBytes;
  // Back off if we would land in the middle of a multi-byte sequence.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.toString("utf8", 0, end);
}

/**
 * The unforgeable authority envelope for a monitor firing. A monitor event is
 * an internal SYSTEM observation: it may add a turn (`steer`) but can NEVER
 * answer a permission gate — matching the channel/hook ceiling. `origin` is set
 * here by WHAT produced the event (a monitor), never read from its content.
 *
 * Returns `{ event_id, monitorId, origin, authority, canApprove, provenance,
 * at, truncated?, source? }` — a caller merges its own observation fields in.
 */
export function monitorEventEnvelope(
  monitorId,
  payload,
  { at = null, source = null, maxBytes = DEFAULT_MAX_EVENT_BYTES } = {},
) {
  const capped = capEventPayload(payload, maxBytes);
  const envelope = {
    origin: ORIGIN.SYSTEM,
    principalId: monitorId != null ? String(monitorId) : null,
    correlationId: source != null ? String(source) : null,
  };
  return {
    event_id: monitorEventId(monitorId, payload),
    monitorId: monitorId != null ? String(monitorId) : null,
    source: source != null ? String(source) : null,
    at: at != null ? Number(at) : null,
    payload: capped.value,
    truncated: capped.truncated,
    origin: envelope.origin,
    authority: authorityForOrigin(ORIGIN.SYSTEM, envelope), // always "steer"
    canApprove: canApprove(envelope), // always false
    provenance: describeAuthorityChain(envelope),
  };
}

/**
 * A time + count bounded set of recently-seen event ids. `shouldEmit(id, now)`
 * records the id and returns `true` only when it is NOT a repeat within the
 * window — so a monitor matching every poll fires the identical event once.
 * Eviction is by age (older than `windowMs`) and by count (`maxEntries`, oldest
 * first), both bounded so memory never grows without limit.
 */
export class DedupWindow {
  constructor({
    windowMs = DEFAULT_DEDUP_WINDOW_MS,
    maxEntries = DEFAULT_DEDUP_MAX_ENTRIES,
  } = {}) {
    this._windowMs = Math.max(0, Number(windowMs) || 0);
    this._maxEntries = Math.max(1, Number(maxEntries) || 1);
    // Insertion-ordered id → lastSeen epoch-ms (Map preserves insertion order).
    this._seen = new Map();
  }

  /**
   * Drop entries older than the window relative to `now`. A full sweep (no
   * early break): refreshing an id updates its timestamp but keeps its Map
   * position, so timestamps are NOT monotonic in iteration order and an early
   * break could skip a genuinely-expired later entry — which would then wrongly
   * suppress its legitimate re-emit. The map is bounded by `maxEntries`, so a
   * full pass is cheap and strictly correct.
   */
  _evictExpired(now) {
    if (this._windowMs === 0) return;
    const cutoff = now - this._windowMs;
    for (const [id, ts] of this._seen) {
      if (ts <= cutoff) this._seen.delete(id);
    }
  }

  /** Enforce the count cap by evicting the oldest entries. */
  _evictOverflow() {
    while (this._seen.size > this._maxEntries) {
      const oldest = this._seen.keys().next().value;
      this._seen.delete(oldest);
    }
  }

  /**
   * True if `eventId` is new within the window (and records it); false if it is
   * a repeat (refreshes its timestamp so a steady stream keeps it suppressed).
   */
  shouldEmit(eventId, now = 0) {
    const nowMs = Number(now) || 0;
    this._evictExpired(nowMs);
    if (this._seen.has(eventId)) {
      // Refresh recency without changing insertion order semantics for eviction.
      this._seen.set(eventId, nowMs);
      return false;
    }
    this._seen.set(eventId, nowMs);
    this._evictOverflow();
    return true;
  }

  /** Number of live (un-evicted) ids currently tracked. */
  get size() {
    return this._seen.size;
  }

  /** Forget everything (e.g. on monitor removal). */
  clear() {
    this._seen.clear();
  }
}

/**
 * A bounded event queue providing backpressure: once full, a `push` drops an
 * event rather than growing the queue, and counts what it dropped so the loss
 * is observable (and auditable) instead of silent.
 *
 *   - `dropPolicy: "oldest"` (default) — evict the head to admit the newcomer
 *     (keep the freshest signal; good for state monitors).
 *   - `dropPolicy: "newest"` — reject the newcomer (preserve order; good when
 *     the first observations matter most).
 */
export class BoundedEventQueue {
  constructor({
    maxSize = DEFAULT_QUEUE_MAX_SIZE,
    dropPolicy = "oldest",
  } = {}) {
    this._maxSize = Math.max(1, Number(maxSize) || 1);
    this._dropPolicy = dropPolicy === "newest" ? "newest" : "oldest";
    this._items = [];
    this._dropped = 0;
  }

  /**
   * Push an event. Returns `{ accepted, dropped }` where `dropped` is the event
   * evicted/rejected to stay within bounds (or null when nothing was dropped).
   */
  push(event) {
    if (this._items.length < this._maxSize) {
      this._items.push(event);
      return { accepted: true, dropped: null };
    }
    if (this._dropPolicy === "newest") {
      this._dropped++;
      return { accepted: false, dropped: event };
    }
    // oldest: evict head, admit newcomer.
    const dropped = this._items.shift();
    this._items.push(event);
    this._dropped++;
    return { accepted: true, dropped };
  }

  /** Remove and return the next event, or undefined when empty. */
  shift() {
    return this._items.shift();
  }

  /** Remove and return every queued event, oldest first. */
  drain() {
    const out = this._items;
    this._items = [];
    return out;
  }

  get size() {
    return this._items.length;
  }

  /** Total events dropped due to backpressure since construction. */
  get dropped() {
    return this._dropped;
  }
}
