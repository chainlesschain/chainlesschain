/**
 * Edit-triggered auto-diagnostics scheduler (P2 "LSP 自动诊断").
 *
 * `CodeIntelligence.refreshFile` already re-diagnoses one file on demand, and
 * `LSPManager` already quarantines a crash-looping server (sliding-window
 * backoff) — those pieces exist. What's missing is the layer that turns a stream
 * of EDITS into well-paced diagnostics runs and bounds their volume:
 *
 *   - DEBOUNCE  — coalesce a burst of rapid edits to one file into a single run
 *                 once edits settle, so typing doesn't spawn a run per keystroke.
 *   - THROTTLE  — a minimum interval between runs for the same file, so a file
 *                 edited continuously still can't run more than once per window.
 *   - TOKEN CAP — bound the diagnostics handed to the model, dropping the least
 *                 severe first, with a truncation marker.
 *
 * Pure + clock-injected (no timers): the caller feeds edit events and a `now`,
 * and asks which files are due. Deterministic and unit-testable.
 */

/** LSP-ish severity → order (lower = more severe). Accepts numbers or labels. */
function severityOrder(sev) {
  if (typeof sev === "number" && Number.isFinite(sev)) return sev; // LSP 1..4
  const m = { error: 1, warning: 2, information: 3, info: 3, hint: 4 };
  return m[String(sev || "").toLowerCase()] ?? 5;
}

export class DiagnosticsScheduler {
  /**
   * @param {object} [opts]
   *   debounceMs — quiet period after the last edit before a run (default 300)
   *   throttleMs — minimum spacing between runs for one file (default 1000)
   */
  constructor({ debounceMs = 300, throttleMs = 1000 } = {}) {
    this.debounceMs =
      Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : 300;
    this.throttleMs =
      Number.isFinite(throttleMs) && throttleMs >= 0 ? throttleMs : 1000;
    this._pending = new Map(); // uri → last edit time
    this._lastRun = new Map(); // uri → last run time
  }

  /** Record an edit to `uri` at `at`. A later edit resets the debounce window. */
  noteEdit(uri, at) {
    if (uri == null) return this;
    this._pending.set(String(uri), Number(at));
    return this;
  }

  /**
   * The URIs whose debounce window has elapsed AND whose throttle interval has
   * passed at `now`. Due URIs are marked run (cleared from pending, `_lastRun`
   * stamped); a throttled URI STAYS pending so it fires once the window passes.
   */
  due(now) {
    const t = Number(now);
    const out = [];
    for (const [uri, editAt] of this._pending) {
      if (t - editAt < this.debounceMs) continue; // still settling
      const last = this._lastRun.get(uri);
      if (last != null && t - last < this.throttleMs) continue; // throttled
      out.push(uri);
    }
    for (const uri of out) {
      this._pending.delete(uri);
      this._lastRun.set(uri, t);
    }
    return out;
  }

  /** ms until the earliest pending URI could next run, or null if none pending. */
  msUntilNextDue(now) {
    const t = Number(now);
    let min = null;
    for (const [uri, editAt] of this._pending) {
      const debounceReady = editAt + this.debounceMs;
      const last = this._lastRun.get(uri);
      const throttleReady = last != null ? last + this.throttleMs : -Infinity;
      const readyAt = Math.max(debounceReady, throttleReady);
      const ms = Math.max(0, readyAt - t);
      if (min == null || ms < min) min = ms;
    }
    return min;
  }

  pendingCount() {
    return this._pending.size;
  }

  reset() {
    this._pending.clear();
    this._lastRun.clear();
  }
}

/**
 * Bound a diagnostics array to a token budget, dropping the LEAST severe first.
 * The estimate is chars/token over each message (plus a small per-item overhead).
 * Always keeps at least one item when the list is non-empty.
 *
 * @returns {{kept:Array, dropped:number, tokens:number, truncated:boolean}}
 */
export function capDiagnostics(
  diagnostics,
  { maxTokens = 2000, charsPerToken = 4, prioritize = true } = {},
) {
  const list = Array.isArray(diagnostics) ? [...diagnostics] : [];
  if (prioritize) {
    list.sort(
      (a, b) => severityOrder(a?.severity) - severityOrder(b?.severity),
    );
  }
  const kept = [];
  let tokens = 0;
  for (const d of list) {
    const cost = Math.max(
      1,
      Math.ceil(
        (String(d?.message || "").length + 24) / Math.max(1, charsPerToken),
      ),
    );
    if (kept.length > 0 && tokens + cost > maxTokens) break;
    kept.push(d);
    tokens += cost;
  }
  const dropped = list.length - kept.length;
  return { kept, dropped, tokens, truncated: dropped > 0 };
}
