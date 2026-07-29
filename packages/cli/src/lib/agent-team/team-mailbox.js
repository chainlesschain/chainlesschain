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
 * The mailbox is bounded by message-count, total-byte, and per-message-byte
 * limits. When an incoming message would cross a limit, messages that have
 * already been delivered to every registered intended recipient are compacted
 * first. Undelivered data is never evicted: if safe compaction is insufficient,
 * `send()` throws a stable coded backpressure error.
 *
 * Pure + deterministic: ids come from a monotonic counter (not a clock) and the
 * clock is injected only for timestamps, so ordering is stable in tests.
 */

import { Buffer } from "node:buffer";

export const TEAM_MAILBOX_ERROR_CODES = Object.freeze({
  MESSAGE_INVALID: "TEAM_MAILBOX_MESSAGE_INVALID",
  MESSAGE_TOO_LARGE: "TEAM_MAILBOX_MESSAGE_TOO_LARGE",
  CAPACITY_EXCEEDED: "TEAM_MAILBOX_CAPACITY_EXCEEDED",
});

export const DEFAULT_TEAM_MAILBOX_LIMITS = Object.freeze({
  maxMessageBytes: 64 * 1024,
  maxMessages: 1000,
  maxTotalBytes: 4 * 1024 * 1024,
});

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function nonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export class TeamMailboxError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TeamMailboxError";
    this.code = code;
    Object.assign(this, details);
  }
}

function createMailboxError(code, message, details = {}) {
  return new TeamMailboxError(code, message, details);
}

export class TeamMailbox {
  constructor({
    now = () => Date.now(),
    maxMessageBytes = DEFAULT_TEAM_MAILBOX_LIMITS.maxMessageBytes,
    maxMessages = DEFAULT_TEAM_MAILBOX_LIMITS.maxMessages,
    maxTotalBytes = DEFAULT_TEAM_MAILBOX_LIMITS.maxTotalBytes,
    recipients = [],
  } = {}) {
    this._now = typeof now === "function" ? now : () => now;
    this._limits = {
      maxMessageBytes: positiveInteger(
        maxMessageBytes,
        DEFAULT_TEAM_MAILBOX_LIMITS.maxMessageBytes,
      ),
      maxMessages: positiveInteger(
        maxMessages,
        DEFAULT_TEAM_MAILBOX_LIMITS.maxMessages,
      ),
      maxTotalBytes: positiveInteger(
        maxTotalBytes,
        DEFAULT_TEAM_MAILBOX_LIMITS.maxTotalBytes,
      ),
    };
    this._log = []; // ordered [{ id, from, to, subject, body, ts }]
    this._entryBytes = new Map(); // id → serialized UTF-8 bytes
    this._totalBytes = 0;
    this._seq = 0; // monotonic message id source
    this._delivered = new Map(); // recipient → highest message id already drained
    this._recipients = new Set(); // authoritative compaction audience
    this._counters = {
      acceptedMessages: 0,
      acceptedBytes: 0,
      rejectedMessages: 0,
      rejectedBytes: 0,
      compactionRuns: 0,
      compactedMessages: 0,
      compactedBytes: 0,
    };
    this.registerRecipients(recipients);
  }

  /**
   * Register the current teammate audience used for safe compaction. A direct
   * message is compactable only after its registered target drains it; a
   * broadcast waits for every registered recipient except its sender.
   *
   * Registration is additive. Newly registered teammates can receive messages
   * that are still retained, but messages safely compacted before they joined
   * are not replayed as history.
   */
  registerRecipients(recipients = []) {
    const values =
      typeof recipients === "string"
        ? [recipients]
        : recipients && typeof recipients[Symbol.iterator] === "function"
          ? Array.from(recipients)
          : [];
    for (const recipient of values) {
      if (
        typeof recipient === "string" &&
        recipient.trim().length > 0 &&
        recipient !== "*"
      ) {
        this._recipients.add(recipient);
      }
    }
    return Array.from(this._recipients);
  }

  /**
   * Post a message. `to` is a teammate id or "*" (broadcast). Returns the stored
   * message (with its assigned id).
   */
  send({ from = null, to, subject = null, body = null } = {}) {
    if (!to || typeof to !== "string") {
      this._recordRejection(0);
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
        "TeamMailbox.send: `to` recipient (or '*') is required",
      );
    }
    let msg = {
      id: this._seq + 1,
      from,
      to,
      subject,
      body,
      ts: this._now(),
    };
    let messageBytes;
    try {
      const serialized = JSON.stringify(msg);
      messageBytes = Buffer.byteLength(serialized, "utf8");
      // Store a detached JSON value so callers cannot mutate a retained body
      // after admission and silently invalidate the byte accounting.
      msg = JSON.parse(serialized);
      if (
        !["id", "from", "to", "subject", "body", "ts"].every((field) =>
          Object.prototype.hasOwnProperty.call(msg, field),
        )
      ) {
        throw new TypeError("message fields must be JSON values");
      }
    } catch (cause) {
      this._counters.rejectedMessages += 1;
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
        "TeamMailbox.send: message must be JSON-serializable",
        { cause },
      );
    }
    if (messageBytes > this._limits.maxMessageBytes) {
      this._recordRejection(messageBytes);
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.MESSAGE_TOO_LARGE,
        `TeamMailbox.send: message is ${messageBytes} bytes; limit is ${this._limits.maxMessageBytes}`,
        {
          messageBytes,
          maxMessageBytes: this._limits.maxMessageBytes,
        },
      );
    }
    if (!this._hasCapacity(messageBytes)) {
      this._compactDelivered();
    }
    if (!this._hasCapacity(messageBytes)) {
      this._recordRejection(messageBytes);
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.CAPACITY_EXCEEDED,
        "TeamMailbox.send: mailbox capacity exceeded; undelivered messages were preserved",
        {
          messageBytes,
          maxMessages: this._limits.maxMessages,
          maxTotalBytes: this._limits.maxTotalBytes,
          currentMessages: this._log.length,
          currentBytes: this._totalBytes,
        },
      );
    }
    this._seq = msg.id;
    this._log.push(msg);
    this._entryBytes.set(msg.id, messageBytes);
    this._totalBytes += messageBytes;
    this._counters.acceptedMessages += 1;
    this._counters.acceptedBytes += messageBytes;
    return this._cloneMessage(msg);
  }

  _serializedBytes(msg) {
    return Buffer.byteLength(JSON.stringify(msg), "utf8");
  }

  _cloneMessage(msg) {
    return JSON.parse(JSON.stringify(msg));
  }

  _recordRejection(messageBytes) {
    this._counters.rejectedMessages += 1;
    this._counters.rejectedBytes += nonNegativeNumber(messageBytes);
  }

  _hasCapacity(messageBytes) {
    return (
      this._log.length + 1 <= this._limits.maxMessages &&
      this._totalBytes + messageBytes <= this._limits.maxTotalBytes
    );
  }

  _fullyDelivered(msg) {
    // Without an explicitly registered audience, removing a message could make
    // a later-known teammate miss it. Prefer backpressure over silent loss.
    if (this._recipients.size === 0) return false;

    if (msg.to !== "*") {
      if (!this._recipients.has(msg.to)) return false;
      // Existing delivery semantics intentionally suppress self-messages.
      if (msg.from === msg.to) return true;
      return (this._delivered.get(msg.to) || 0) >= msg.id;
    }

    for (const recipient of this._recipients) {
      if (recipient === msg.from) continue;
      if ((this._delivered.get(recipient) || 0) < msg.id) return false;
    }
    return true;
  }

  _compactDelivered() {
    let compactedMessages = 0;
    let compactedBytes = 0;
    const retained = [];
    for (const msg of this._log) {
      if (this._fullyDelivered(msg)) {
        compactedMessages += 1;
        const bytes =
          this._entryBytes.get(msg.id) ?? this._serializedBytes(msg);
        compactedBytes += bytes;
        this._entryBytes.delete(msg.id);
      } else {
        retained.push(msg);
      }
    }
    if (compactedMessages > 0) {
      this._log = retained;
      this._totalBytes = Math.max(0, this._totalBytes - compactedBytes);
      this._counters.compactionRuns += 1;
      this._counters.compactedMessages += compactedMessages;
      this._counters.compactedBytes += compactedBytes;
    }
    return { messages: compactedMessages, bytes: compactedBytes };
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
      .map((m) => this._cloneMessage(m));
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
    return this._log.map((m) => this._cloneMessage(m));
  }

  size() {
    return this._log.length;
  }

  /**
   * Current bounded-queue pressure. `ratio` is the stricter of message-count
   * and byte pressure; `full` means a non-empty next message cannot fit without
   * compaction.
   */
  pressure() {
    const messageRatio = this._log.length / this._limits.maxMessages;
    const byteRatio = this._totalBytes / this._limits.maxTotalBytes;
    const ratio = Math.max(messageRatio, byteRatio);
    const level =
      ratio >= 1
        ? "full"
        : ratio >= 0.95
          ? "critical"
          : ratio >= 0.8
            ? "high"
            : "normal";
    return {
      ratio,
      messageRatio,
      byteRatio,
      level,
      full:
        this._log.length >= this._limits.maxMessages ||
        this._totalBytes >= this._limits.maxTotalBytes,
    };
  }

  /** Queue usage, configured limits, registered audience, and lifetime counts. */
  status() {
    return {
      messages: this._log.length,
      totalBytes: this._totalBytes,
      limits: { ...this._limits },
      recipients: Array.from(this._recipients),
      registeredRecipients: this._recipients.size,
      pressure: this.pressure(),
      counters: { ...this._counters },
    };
  }

  snapshot() {
    return {
      version: 2,
      limits: { ...this._limits },
      log: this._log.map((m) => this._cloneMessage(m)),
      seq: this._seq,
      delivered: Array.from(this._delivered.entries()),
      recipients: Array.from(this._recipients),
      totalBytes: this._totalBytes,
      counters: { ...this._counters },
    };
  }

  static restore(
    snap,
    {
      now = () => Date.now(),
      maxMessageBytes,
      maxMessages,
      maxTotalBytes,
    } = {},
  ) {
    const savedLimits = snap?.limits || {};
    const mb = new TeamMailbox({
      now,
      maxMessageBytes:
        maxMessageBytes ??
        savedLimits.maxMessageBytes ??
        DEFAULT_TEAM_MAILBOX_LIMITS.maxMessageBytes,
      maxMessages:
        maxMessages ??
        savedLimits.maxMessages ??
        DEFAULT_TEAM_MAILBOX_LIMITS.maxMessages,
      maxTotalBytes:
        maxTotalBytes ??
        savedLimits.maxTotalBytes ??
        DEFAULT_TEAM_MAILBOX_LIMITS.maxTotalBytes,
      recipients: snap?.recipients || [],
    });
    mb._log = Array.isArray(snap?.log)
      ? snap.log.map((m) => mb._cloneMessage(m))
      : [];
    mb._entryBytes = new Map();
    mb._totalBytes = 0;
    let previousId = 0;
    for (const msg of mb._log) {
      if (
        !msg ||
        typeof msg !== "object" ||
        !Number.isSafeInteger(msg.id) ||
        msg.id <= previousId ||
        typeof msg.to !== "string" ||
        msg.to.length === 0
      ) {
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
          "TeamMailbox.restore: invalid message log",
        );
      }
      const bytes = mb._serializedBytes(msg);
      if (bytes > mb._limits.maxMessageBytes) {
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.MESSAGE_TOO_LARGE,
          "TeamMailbox.restore: retained message exceeds its byte limit",
          {
            messageBytes: bytes,
            maxMessageBytes: mb._limits.maxMessageBytes,
          },
        );
      }
      mb._entryBytes.set(msg.id, bytes);
      mb._totalBytes += bytes;
      previousId = msg.id;
    }
    if (
      mb._log.length > mb._limits.maxMessages ||
      mb._totalBytes > mb._limits.maxTotalBytes
    ) {
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.CAPACITY_EXCEEDED,
        "TeamMailbox.restore: retained log exceeds mailbox capacity",
        {
          currentMessages: mb._log.length,
          currentBytes: mb._totalBytes,
          maxMessages: mb._limits.maxMessages,
          maxTotalBytes: mb._limits.maxTotalBytes,
        },
      );
    }
    const savedSeq = Number(snap?.seq);
    mb._seq = Math.max(
      Number.isSafeInteger(savedSeq) && savedSeq >= 0 ? savedSeq : 0,
      previousId,
    );
    mb._delivered = new Map();
    for (const entry of Array.isArray(snap?.delivered) ? snap.delivered : []) {
      const [recipient, cursor] = Array.isArray(entry) ? entry : [];
      if (
        typeof recipient !== "string" ||
        !recipient ||
        !Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        cursor > mb._seq
      ) {
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
          "TeamMailbox.restore: invalid delivery cursor",
        );
      }
      mb._delivered.set(recipient, cursor);
    }
    const counters = snap?.counters;
    mb._counters = {
      acceptedMessages: nonNegativeNumber(counters?.acceptedMessages, mb._seq),
      acceptedBytes: nonNegativeNumber(counters?.acceptedBytes, mb._totalBytes),
      rejectedMessages: nonNegativeNumber(counters?.rejectedMessages),
      rejectedBytes: nonNegativeNumber(counters?.rejectedBytes),
      compactionRuns: nonNegativeNumber(counters?.compactionRuns),
      compactedMessages: nonNegativeNumber(counters?.compactedMessages),
      compactedBytes: nonNegativeNumber(counters?.compactedBytes),
    };
    return mb;
  }
}
