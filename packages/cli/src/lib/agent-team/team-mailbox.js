/**
 * TeamMailbox (Phase 4 — Agent Team) — directed + broadcast messaging between
 * teammates so a coordinating agent can hand off context, flag a finding, or ask
 * a peer to redo work (Phase 4 work-item "支持 Agent 间直接消息和定向通知",
 * acceptance "团队会话恢复后…消息…保持一致").
 *
 * A message is addressed to a specific recipient (`to`) or broadcast (`to:"*"`).
 * `drain(recipient)` returns that recipient's undelivered messages (direct +
 * broadcasts it hasn't seen) and marks them delivered FOR THAT RECIPIENT — a
 * broadcast is delivered independently to each teammate, so two teammates each
 * receive it exactly once. Delivery cursors + the log are in the snapshot, so a
 * resumed session re-delivers only what a teammate hadn't yet drained.
 *
 * Pure + deterministic: ids come from a monotonic counter (not a clock) and the
 * clock is injected only for timestamps, so ordering is stable in tests.
 */

export class TeamMailbox {
  constructor({ now = () => Date.now() } = {}) {
    this._now = typeof now === "function" ? now : () => now;
    this._log = []; // ordered [{ id, from, to, subject, body, ts }]
    this._seq = 0; // monotonic message id source
    this._delivered = new Map(); // recipient → highest message id already drained
  }

  /**
   * Post a message. `to` is a teammate id or "*" (broadcast). Returns the stored
   * message (with its assigned id).
   */
  send({ from = null, to, subject = null, body = null } = {}) {
    if (!to || typeof to !== "string") {
      throw new Error("TeamMailbox.send: `to` recipient (or '*') is required");
    }
    const msg = {
      id: ++this._seq,
      from,
      to,
      subject,
      body,
      ts: this._now(),
    };
    this._log.push(msg);
    return { ...msg };
  }

  _isFor(msg, recipient) {
    return msg.to === recipient || msg.to === "*";
  }

  /** Peek at a recipient's undelivered messages WITHOUT marking them delivered. */
  peek(recipient) {
    const cursor = this._delivered.get(recipient) || 0;
    return this._log
      .filter(
        (m) =>
          m.id > cursor && m.from !== recipient && this._isFor(m, recipient),
      )
      .map((m) => ({ ...m }));
  }

  /**
   * Return a recipient's undelivered messages and advance its delivery cursor so
   * they are not returned again. A teammate never receives its own broadcast.
   */
  drain(recipient) {
    const pending = this.peek(recipient);
    if (pending.length > 0) {
      const highest = pending[pending.length - 1].id;
      const cursor = this._delivered.get(recipient) || 0;
      this._delivered.set(recipient, Math.max(cursor, highest));
    }
    return pending;
  }

  /** How many messages a recipient has yet to drain. */
  pendingCount(recipient) {
    return this.peek(recipient).length;
  }

  /** The full ordered message log (for a status panel / audit). */
  log() {
    return this._log.map((m) => ({ ...m }));
  }

  size() {
    return this._log.length;
  }

  snapshot() {
    return {
      log: this._log.map((m) => ({ ...m })),
      seq: this._seq,
      delivered: Array.from(this._delivered.entries()),
    };
  }

  static restore(snap, { now = () => Date.now() } = {}) {
    const mb = new TeamMailbox({ now });
    mb._log = Array.isArray(snap?.log) ? snap.log.map((m) => ({ ...m })) : [];
    mb._seq =
      Number(snap?.seq) ||
      mb._log.reduce((max, m) => Math.max(max, m.id || 0), 0);
    mb._delivered = new Map(snap?.delivered || []);
    return mb;
  }
}
