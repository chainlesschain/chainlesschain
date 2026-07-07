/**
 * RemoteCommandLedger (Phase 5, Remote Control) — application-level idempotency
 * + total ordering + device revocation for commands arriving from remote
 * endpoints (terminal / web / mobile).
 *
 * The transport layer (remote-session-crypto) already rejects a replayed or
 * out-of-order ENVELOPE within one connection — but a reconnect starts a fresh
 * crypto session with a reset sequence baseline, so a command the client
 * re-sends after a dropped ACK would sail through and EXECUTE A SECOND TIME. That
 * is exactly the Phase 5 acceptance this guards: "断网恢复后不会重复执行工具调用".
 *
 * Guarantees:
 *   - Idempotency: a command carries a stable `commandId`; the side effect runs
 *     AT MOST ONCE. A re-delivered command returns its cached result flagged
 *     `replayed` — it never re-executes.
 *   - Total order: every applied command gets a monotonic `applyIndex`, so all
 *     three endpoints agree on one order; `appliedSince(cursor)` lets a
 *     reconnecting endpoint catch up deterministically.
 *   - Revocation: a revoked device's commands are rejected (can't read/control).
 *
 * Pure + injectable clock → fully unit-testable without any transport/hardware.
 */

export class RemoteCommandLedger {
  constructor({
    now = () => Date.now(),
    revokedDevices = [],
    maxApplied = 10000,
  } = {}) {
    this._now = typeof now === "function" ? now : () => now;
    this._applied = new Map(); // commandId → { applyIndex, result, deviceId, ts }
    this._order = []; // retained tail; applyIndex of _order[i] = _baseIndex + i
    this._baseIndex = 0; // applyIndex of _order[0] (advances as old entries evict)
    // Retention window: a long-lived `cc serve` would otherwise grow the ledger
    // (and its snapshot) without bound — ~14 MB per 50k commands measured. The
    // window must stay large relative to the reconnect-redelivery horizon: a
    // commandId evicted from the window loses idempotency protection and would
    // re-execute if re-delivered afterwards.
    this._maxApplied = Math.max(1, Number(maxApplied) || 10000);
    this._revoked = new Set(revokedDevices);
    this._perDeviceSeq = new Map(); // deviceId → highest accepted seq
    this._inFlight = new Map(); // commandId → Promise<record> for an in-progress apply
  }

  isRevoked(deviceId) {
    return this._revoked.has(deviceId);
  }

  revokeDevice(deviceId) {
    this._revoked.add(deviceId);
  }

  /**
   * Apply a command idempotently. `execute` (async, side-effecting) runs AT MOST
   * ONCE per commandId; a re-delivery returns the cached result without calling
   * it again.
   *
   * @param {{commandId:string, deviceId:string, seq?:number, payload?:any}} command
   * @param {(command)=>Promise<any>|any} execute
   * @returns {Promise<{status:"applied"|"replayed"|"rejected", result?, reason?, applyIndex?}>}
   */
  async apply(command, execute) {
    if (
      !command ||
      typeof command.commandId !== "string" ||
      !command.commandId
    ) {
      return { status: "rejected", reason: "missing commandId" };
    }
    const { commandId, deviceId } = command;

    // A revoked device can neither read nor control the session.
    if (deviceId != null && this._revoked.has(deviceId)) {
      return { status: "rejected", reason: "device revoked" };
    }

    // Idempotent replay: already applied → return the cached result, DO NOT
    // re-run the side effect. This is the reconnect-safety guarantee.
    const prior = this._applied.get(commandId);
    if (prior) {
      return {
        status: "replayed",
        result: prior.result,
        applyIndex: prior.applyIndex,
      };
    }

    // Coalesce CONCURRENT deliveries of the same commandId. `execute` is awaited
    // below, so without this a second delivery arriving while the first is still
    // running would ALSO pass the `prior` check (nothing is recorded until
    // execute resolves) and run the side effect a SECOND time — the exact
    // double-exec this ledger exists to prevent on reconnect. An already-in-flight
    // same-commandId delivery waits for it and returns its result as `replayed`.
    const inflight = this._inFlight.get(commandId);
    if (inflight) {
      try {
        const rec = await inflight;
        return {
          status: "replayed",
          result: rec.result,
          applyIndex: rec.applyIndex,
        };
      } catch {
        // The in-flight execution failed → it recorded nothing and is retryable;
        // report rejection to this caller too (it can retry the same commandId).
        return { status: "rejected", reason: "concurrent execution failed" };
      }
    }

    // Optional per-device monotonic sequence check: a STALE seq (below what we've
    // already accepted from this device) with a NEW commandId is a protocol
    // violation (a genuine reconnect resends the SAME commandId, caught above).
    if (
      deviceId != null &&
      Number.isFinite(command.seq) &&
      this._perDeviceSeq.has(deviceId) &&
      command.seq <= this._perDeviceSeq.get(deviceId)
    ) {
      return { status: "rejected", reason: "stale sequence" };
    }

    // Reserve the commandId BEFORE the first await so a concurrent same-id
    // delivery (above) sees it in flight. The promise records the applied result
    // on success and rejects on failure (so a retry can re-run the side effect).
    const runPromise = (async () => {
      const result = await execute(command);
      const applyIndex = this._baseIndex + this._order.length;
      const rec = { applyIndex, result, deviceId, ts: this._now() };
      this._applied.set(commandId, rec);
      this._order.push(commandId);
      if (deviceId != null && Number.isFinite(command.seq)) {
        // Advance-only watermark. Two in-flight commands from one device can
        // RECORD out of order (seq 6 settles before seq 5 — both passed the
        // stale check while nothing was recorded); a plain set() would regress
        // the watermark to 5 and let a NEW commandId reuse seq 6.
        const cur = this._perDeviceSeq.get(deviceId);
        this._perDeviceSeq.set(
          deviceId,
          cur == null ? command.seq : Math.max(cur, command.seq),
        );
      }
      this._evictBeyondWindow();
      return rec;
    })();
    this._inFlight.set(commandId, runPromise);
    try {
      const rec = await runPromise;
      return {
        status: "applied",
        result: rec.result,
        applyIndex: rec.applyIndex,
      };
    } catch (err) {
      // A failed execution is NOT recorded as applied — the command may be
      // retried (with the same commandId) and will run again. Surfacing the
      // error lets the caller decide; idempotency only protects SUCCESSES.
      return { status: "rejected", reason: `execute failed: ${err.message}` };
    } finally {
      this._inFlight.delete(commandId);
    }
  }

  /** Chunked eviction of the oldest applied entries beyond the window. */
  _evictBeyondWindow() {
    // Amortized: only compact once we're 50% past the cap, then cut back to
    // exactly the cap — avoids an O(n) splice on every insert at steady state.
    if (this._order.length <= this._maxApplied * 1.5) return;
    const excess = this._order.length - this._maxApplied;
    const evicted = this._order.splice(0, excess);
    for (const id of evicted) this._applied.delete(id);
    this._baseIndex += excess;
  }

  /**
   * The ordered tail of applied commands after `cursor` (an applyIndex), so a
   * reconnecting endpoint can replay missed state in the one agreed order.
   * Entries older than the retention window are gone — a caller can detect the
   * gap by comparing the first element's applyIndex against its cursor+1 (see
   * `oldestRetainedIndex()`), and should then resync full state instead.
   * @returns {Array<{applyIndex, commandId, result, deviceId}>}
   */
  appliedSince(cursor = -1) {
    const out = [];
    const start = Math.max(cursor + 1, this._baseIndex);
    const end = this._baseIndex + this._order.length;
    for (let i = start; i < end; i++) {
      const commandId = this._order[i - this._baseIndex];
      const rec = this._applied.get(commandId);
      out.push({
        applyIndex: i,
        commandId,
        result: rec.result,
        deviceId: rec.deviceId,
      });
    }
    return out;
  }

  /** Lowest applyIndex still retained (entries below it were evicted). */
  oldestRetainedIndex() {
    return this._baseIndex;
  }

  /** Highest assigned applyIndex (−1 when nothing applied). */
  cursor() {
    return this._baseIndex + this._order.length - 1;
  }

  /** Total commands ever applied (including evicted ones). */
  appliedCount() {
    return this._baseIndex + this._order.length;
  }

  snapshot() {
    return {
      order: [...this._order],
      baseIndex: this._baseIndex,
      maxApplied: this._maxApplied,
      applied: Array.from(this._applied.entries()),
      revoked: Array.from(this._revoked),
      perDeviceSeq: Array.from(this._perDeviceSeq.entries()),
    };
  }

  static restore(snap, { now = () => Date.now(), maxApplied } = {}) {
    const l = new RemoteCommandLedger({
      now,
      // Restore keeps the snapshot's window unless the caller overrides it;
      // old (pre-window) snapshots fall back to the default.
      maxApplied: maxApplied ?? snap?.maxApplied,
    });
    l._order = [...(snap?.order || [])];
    l._baseIndex = Number.isFinite(snap?.baseIndex) ? snap.baseIndex : 0;
    l._applied = new Map(snap?.applied || []);
    l._revoked = new Set(snap?.revoked || []);
    l._perDeviceSeq = new Map(snap?.perDeviceSeq || []);
    return l;
  }
}
