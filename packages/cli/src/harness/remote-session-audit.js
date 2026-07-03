// Remote Session audit log.
//
// A bounded, in-memory, privacy-respecting audit trail for one CLI host process
// — matched to the ephemeral (in-memory, 12h TTL) nature of remote sessions.
// Captures WHO did WHAT and WHEN across a session's lifecycle and remote control
// events, but deliberately does NOT record prompt/tool payloads (only shapes
// like content length), keeping the trail useful for forensics without
// hoarding session content. A pluggable `sink` seam lets a durable backend
// (JSONL file, SQLite audit_log) be attached later without touching call sites.

const DEFAULT_MAX_ENTRIES = 1000;

export const REMOTE_SESSION_AUDIT_ACTIONS = Object.freeze([
  "session.created",
  "pairing-token.issued",
  "device.joined",
  "device.revoked",
  "device.disconnected",
  "session.closed",
  "control.prompt",
  "control.approval",
  "control.interrupt",
  "push.registered",
  "push.sent",
  "push.failed",
  "push.skipped",
  "push.unregistered",
]);

export class RemoteSessionAuditLog {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
    this.sink = typeof options.sink === "function" ? options.sink : null;
    this.entries = [];
    this.seq = 0;
    // Hydrate from a durable sink so audit queries survive a host restart. The
    // persisted entries are NOT re-written to the sink (they are already
    // there); we only pre-fill the in-memory ring and carry the seq high-water
    // forward so new entries stay strictly monotonic.
    if (Array.isArray(options.initialEntries)) {
      this._hydrate(options.initialEntries);
    }
  }

  _hydrate(entries) {
    const recent = entries.slice(-this.maxEntries);
    for (const entry of recent) {
      if (!entry || !entry.action) continue;
      this.entries.push({ ...entry });
      if (typeof entry.seq === "number" && entry.seq > this.seq) {
        this.seq = entry.seq;
      }
    }
  }

  /**
   * Append an audit entry. Never throws into the caller — a broken sink or bad
   * argument must not take down the live session it is auditing.
   */
  record({ sessionId = null, actor = null, action, detail = null } = {}) {
    if (!action) return null;
    const entry = {
      seq: (this.seq += 1),
      timestamp: this.now(),
      sessionId,
      actor,
      action,
      detail: detail && typeof detail === "object" ? { ...detail } : detail,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    if (this.sink) {
      try {
        this.sink(entry);
      } catch {
        // A durable-sink failure must not break the session being audited.
      }
    }
    return entry;
  }

  /** Newest-first, optionally filtered by session and/or action. */
  list({ sessionId, action, limit } = {}) {
    let out = this.entries;
    if (sessionId) out = out.filter((entry) => entry.sessionId === sessionId);
    if (action) out = out.filter((entry) => entry.action === action);
    out = [...out].reverse();
    if (limit && limit > 0) out = out.slice(0, limit);
    return out.map((entry) => ({ ...entry }));
  }

  stats(sessionId) {
    const scope = sessionId
      ? this.entries.filter((entry) => entry.sessionId === sessionId)
      : this.entries;
    const byAction = {};
    for (const entry of scope) {
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
    }
    return { total: scope.length, byAction };
  }

  clear() {
    this.entries = [];
    this.seq = 0;
  }
}
