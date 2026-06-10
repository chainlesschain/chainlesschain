/**
 * In-memory activity log for the IDE bridge — a small ring buffer of events
 * (tool calls, connects) that the status bar, sidebar tree, and webview
 * dashboard all render from. Pure (no `vscode`), so it is unit-testable; the UI
 * just subscribes via onChange.
 */
class ActivityLog {
  constructor({ max = 200 } = {}) {
    this._max = max;
    this._entries = [];
    this._listeners = new Set();
    this._counts = { tool: 0, connect: 0, error: 0 };
  }

  /**
   * Append an event. Shape: { type:"tool"|"connect", tool?, ok?, error?,
   * argsSummary?, ts }. Returns the stored (normalized) entry.
   */
  record(entry) {
    const e = { ts: Date.now(), ...entry };
    this._entries.push(e);
    if (this._entries.length > this._max) this._entries.shift();
    if (e.type === "tool") this._counts.tool++;
    if (e.type === "connect") this._counts.connect++;
    if (e.ok === false) this._counts.error++;
    for (const l of this._listeners) {
      try {
        l(e);
      } catch {
        /* a bad listener must not break logging */
      }
    }
    return e;
  }

  /** All entries, oldest first. */
  entries() {
    return this._entries.slice();
  }

  /** The most recent `n` entries, newest first. */
  recent(n = 20) {
    return this._entries.slice(-n).reverse();
  }

  counts() {
    return { ...this._counts };
  }

  clear() {
    this._entries = [];
    for (const l of this._listeners) {
      try {
        l(null);
      } catch {
        /* ignore */
      }
    }
  }

  /** Subscribe; returns an unsubscribe fn. */
  onChange(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
}

/** Short, non-sensitive summary of a tool call's arguments for display. */
function summarizeArgs(toolName, args) {
  if (!args || typeof args !== "object") return "";
  if (toolName === "openDiff") {
    const p = typeof args.path === "string" ? args.path : "";
    return p ? shortenPath(p) : "";
  }
  if (toolName === "getDiagnostics" && typeof args.path === "string") {
    return shortenPath(args.path);
  }
  return "";
}

function shortenPath(p) {
  const parts = String(p).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 ? p : "…/" + parts.slice(-2).join("/");
}

module.exports = { ActivityLog, summarizeArgs, shortenPath };
