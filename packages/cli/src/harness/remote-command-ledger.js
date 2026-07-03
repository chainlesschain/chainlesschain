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
  constructor({ now = () => Date.now(), revokedDevices = [] } = {}) {
    this._now = typeof now === "function" ? now : () => now;
    this._applied = new Map(); // commandId → { applyIndex, result, deviceId, ts }
    this._order = []; // applyIndex → commandId (total order)
    this._revoked = new Set(revokedDevices);
    this._perDeviceSeq = new Map(); // deviceId → highest accepted seq
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

    let result;
    try {
      result = await execute(command);
    } catch (err) {
      // A failed execution is NOT recorded as applied — the command may be
      // retried (with the same commandId) and will run again. Surfacing the
      // error lets the caller decide; idempotency only protects SUCCESSES.
      return { status: "rejected", reason: `execute failed: ${err.message}` };
    }

    const applyIndex = this._order.length;
    this._applied.set(commandId, {
      applyIndex,
      result,
      deviceId,
      ts: this._now(),
    });
    this._order.push(commandId);
    if (deviceId != null && Number.isFinite(command.seq)) {
      this._perDeviceSeq.set(deviceId, command.seq);
    }
    return { status: "applied", result, applyIndex };
  }

  /**
   * The ordered tail of applied commands after `cursor` (an applyIndex), so a
   * reconnecting endpoint can replay missed state in the one agreed order.
   * @returns {Array<{applyIndex, commandId, result, deviceId}>}
   */
  appliedSince(cursor = -1) {
    const out = [];
    for (let i = cursor + 1; i < this._order.length; i++) {
      const commandId = this._order[i];
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

  /** Highest assigned applyIndex (−1 when nothing applied). */
  cursor() {
    return this._order.length - 1;
  }

  appliedCount() {
    return this._order.length;
  }

  snapshot() {
    return {
      order: [...this._order],
      applied: Array.from(this._applied.entries()),
      revoked: Array.from(this._revoked),
      perDeviceSeq: Array.from(this._perDeviceSeq.entries()),
    };
  }

  static restore(snap, { now = () => Date.now() } = {}) {
    const l = new RemoteCommandLedger({ now });
    l._order = [...(snap?.order || [])];
    l._applied = new Map(snap?.applied || []);
    l._revoked = new Set(snap?.revoked || []);
    l._perDeviceSeq = new Map(snap?.perDeviceSeq || []);
    return l;
  }
}
