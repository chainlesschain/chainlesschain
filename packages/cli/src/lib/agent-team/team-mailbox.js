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
import { createHash } from "node:crypto";

export const TEAM_MAILBOX_ERROR_CODES = Object.freeze({
  MESSAGE_INVALID: "TEAM_MAILBOX_MESSAGE_INVALID",
  MESSAGE_TOO_LARGE: "TEAM_MAILBOX_MESSAGE_TOO_LARGE",
  CAPACITY_EXCEEDED: "TEAM_MAILBOX_CAPACITY_EXCEEDED",
  ACK_INVALID: "TEAM_MAILBOX_ACK_INVALID",
  ACK_CONFLICT: "TEAM_MAILBOX_ACK_CONFLICT",
});

export const DEFAULT_TEAM_MAILBOX_LIMITS = Object.freeze({
  maxMessageBytes: 64 * 1024,
  maxMessages: 1000,
  maxTotalBytes: 4 * 1024 * 1024,
  maxReceiptHistory: 5000,
  maxIdempotencyHistory: 256,
});

const RECEIPT_STATUSES = new Set([
  "delivered",
  "read",
  "processed",
  "dead_letter",
]);
const ACK_STATUSES = new Set(["read", "processed", "dead_letter"]);

function digestValue(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")}`;
}

function boundedString(value, label, maximum = 128) {
  const text = String(value || "").trim();
  if (
    !text ||
    text.length > maximum ||
    Array.from(text).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw createMailboxError(
      TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
      `${label} must be a non-empty bounded string without control characters`,
    );
  }
  return text;
}

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
    maxReceiptHistory = DEFAULT_TEAM_MAILBOX_LIMITS.maxReceiptHistory,
    maxIdempotencyHistory = DEFAULT_TEAM_MAILBOX_LIMITS.maxIdempotencyHistory,
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
      maxReceiptHistory: positiveInteger(
        maxReceiptHistory,
        DEFAULT_TEAM_MAILBOX_LIMITS.maxReceiptHistory,
      ),
      maxIdempotencyHistory: positiveInteger(
        maxIdempotencyHistory,
        DEFAULT_TEAM_MAILBOX_LIMITS.maxIdempotencyHistory,
      ),
    };
    this._log = []; // ordered [{ id, from, to, subject, body, ts }]
    this._entryBytes = new Map(); // id → serialized UTF-8 bytes
    this._totalBytes = 0;
    this._seq = 0; // monotonic message id source
    this._delivered = new Map(); // recipient → highest message id already drained
    this._recipients = new Set(); // authoritative compaction audience
    this._receipts = new Map(); // recipient\0message id → delivery/processing receipt
    this._idempotency = new Map(); // sender\0key → admitted message digest + id
    this._counters = {
      acceptedMessages: 0,
      acceptedBytes: 0,
      rejectedMessages: 0,
      rejectedBytes: 0,
      compactionRuns: 0,
      compactedMessages: 0,
      compactedBytes: 0,
      deliveryAttempts: 0,
      processedMessages: 0,
      deadLetteredMessages: 0,
      idempotentReplays: 0,
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
  send({
    from = null,
    to,
    subject = null,
    body = null,
    mode = "send",
    idempotencyKey = null,
    causationId = null,
    correlationId = null,
    senderAttempt = null,
  } = {}) {
    if (!to || typeof to !== "string") {
      this._recordRejection(0);
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
        "TeamMailbox.send: `to` recipient (or '*') is required",
      );
    }
    const normalizedMode = mode === "followup" ? "followup" : "send";
    const normalizedIdempotencyKey =
      idempotencyKey == null
        ? null
        : boundedString(idempotencyKey, "idempotencyKey");
    const senderTaskKey =
      senderAttempt && typeof senderAttempt.taskKey === "string"
        ? senderAttempt.taskKey
        : "";
    const dedupKey = normalizedIdempotencyKey
      ? `${String(from || "")}\0${senderTaskKey}\0${normalizedIdempotencyKey}`
      : null;
    let payloadDigest;
    try {
      payloadDigest = digestValue({
        from,
        to,
        subject,
        body,
        mode: normalizedMode,
        causationId,
        correlationId,
      });
    } catch (cause) {
      this._recordRejection(0);
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
        "TeamMailbox.send: message must be JSON-serializable",
        { cause },
      );
    }
    if (dedupKey && this._idempotency.has(dedupKey)) {
      const prior = this._idempotency.get(dedupKey);
      if (prior.payloadDigest !== payloadDigest) {
        this._recordRejection(0);
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
          "TeamMailbox.send: idempotency key was reused with different content",
        );
      }
      this._counters.idempotentReplays += 1;
      const retained = this._log.find((entry) => entry.id === prior.messageId);
      return retained
        ? this._cloneMessage(retained)
        : { ...this._cloneMessage(prior.message), idempotentReplay: true };
    }
    let msg = {
      id: this._seq + 1,
      from,
      to,
      subject,
      body,
      ts: this._now(),
      ...(normalizedMode === "followup" ? { mode: normalizedMode } : {}),
      ...(normalizedIdempotencyKey
        ? { idempotencyKey: normalizedIdempotencyKey }
        : {}),
      ...(causationId != null ? { causationId } : {}),
      ...(correlationId != null ? { correlationId } : {}),
      ...(senderAttempt != null ? { senderAttempt } : {}),
      payloadDigest,
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
    if (dedupKey) {
      this._idempotency.set(dedupKey, {
        messageId: msg.id,
        payloadDigest,
        message: this._cloneMessage(msg),
      });
      this._trimIdempotencyHistory();
    }
    return this._cloneMessage(msg);
  }

  _trimIdempotencyHistory() {
    while (this._idempotency.size > this._limits.maxIdempotencyHistory) {
      const oldest = this._idempotency.keys().next().value;
      this._idempotency.delete(oldest);
    }
  }

  _receiptKey(recipient, messageId) {
    return `${recipient}\0${messageId}`;
  }

  _trimReceiptHistory(targetSize = this._limits.maxReceiptHistory) {
    if (this._receipts.size <= targetSize) return;
    const liveIds = new Set(this._log.map((message) => message.id));
    for (const [key, receipt] of this._receipts) {
      if (this._receipts.size <= targetSize) break;
      const cursor = this._delivered.get(receipt.recipient) || 0;
      if (!liveIds.has(receipt.messageId) || receipt.messageId <= cursor) {
        this._receipts.delete(key);
      }
    }
  }

  _ensureReceiptCapacity(additionalReceipts) {
    this._trimReceiptHistory(
      Math.max(0, this._limits.maxReceiptHistory - additionalReceipts),
    );
    if (
      this._receipts.size + additionalReceipts >
      this._limits.maxReceiptHistory
    ) {
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.CAPACITY_EXCEEDED,
        "TeamMailbox: receipt history capacity exceeded; unsettled receipts were preserved",
        {
          currentReceipts: this._receipts.size,
          additionalReceipts,
          maxReceiptHistory: this._limits.maxReceiptHistory,
        },
      );
    }
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
   * Deliver an at-least-once batch without advancing the processed cursor.
   * Repeated calls return the same unacknowledged messages with a monotonically
   * increasing delivery count. `acknowledge()` is the only real-time path that
   * retires them.
   */
  receive(recipient, { limit = 100, markRead = false } = {}) {
    const boundedLimit = Math.max(
      1,
      Math.min(100, positiveInteger(limit, 100)),
    );
    const now = this._now();
    const messages = this.peek(recipient)
      .filter((message) => {
        const receipt = this._receipts.get(
          this._receiptKey(recipient, message.id),
        );
        return (
          !receipt || !["processed", "dead_letter"].includes(receipt.status)
        );
      })
      .slice(0, boundedLimit);
    const newReceiptCount = messages.reduce(
      (count, message) =>
        count +
        (this._receipts.has(this._receiptKey(recipient, message.id)) ? 0 : 1),
      0,
    );
    this._ensureReceiptCapacity(newReceiptCount);
    return messages.map((message) => {
      const key = this._receiptKey(recipient, message.id);
      const existing = this._receipts.get(key);
      const receipt = existing || {
        recipient,
        messageId: message.id,
        status: "delivered",
        deliveryCount: 0,
        deliveredAt: null,
        readAt: null,
        processedAt: null,
        deadLetteredAt: null,
        consumerKey: null,
        reason: null,
        recipientAttempt: null,
      };
      if (!["processed", "dead_letter"].includes(receipt.status)) {
        receipt.deliveryCount += 1;
        receipt.deliveredAt ||= now;
        if (markRead) {
          receipt.status = "read";
          receipt.readAt ||= now;
        } else if (receipt.status !== "read") {
          receipt.status = "delivered";
        }
        this._receipts.set(key, receipt);
        this._counters.deliveryAttempts += 1;
      }
      return {
        ...message,
        delivery: this._cloneMessage(receipt),
      };
    });
  }

  /**
   * Persist read/processed/dead-letter receipts for explicit message ids.
   * Processing is idempotent for the same consumer key and conflicts closed
   * when another consumer key tries to claim the same message.
   */
  acknowledge(
    recipient,
    {
      messageIds = [],
      consumerKey,
      status = "processed",
      reason = null,
      recipientAttempt = null,
    } = {},
  ) {
    if (
      !Array.isArray(messageIds) ||
      messageIds.length === 0 ||
      messageIds.length > 100 ||
      messageIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    ) {
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.ACK_INVALID,
        "TeamMailbox.acknowledge: messageIds must contain 1-100 positive integer ids",
      );
    }
    const uniqueIds = [...new Set(messageIds)];
    if (uniqueIds.length !== messageIds.length) {
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.ACK_INVALID,
        "TeamMailbox.acknowledge: duplicate message ids are not allowed",
      );
    }
    if (!ACK_STATUSES.has(status)) {
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.ACK_INVALID,
        "TeamMailbox.acknowledge: status is invalid",
      );
    }
    const normalizedConsumerKey = boundedString(
      consumerKey,
      "consumerKey",
      256,
    );
    let normalizedRecipientAttempt = null;
    if (recipientAttempt != null) {
      try {
        normalizedRecipientAttempt = this._cloneMessage(recipientAttempt);
      } catch (cause) {
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.ACK_INVALID,
          "TeamMailbox.acknowledge: recipientAttempt must be JSON-serializable",
          { cause },
        );
      }
    }
    const normalizedReason = String(reason || "poison_message").slice(0, 1024);
    const byId = new Map(this._log.map((message) => [message.id, message]));
    const plans = uniqueIds.map((id) => {
      const message = byId.get(id);
      const key = this._receiptKey(recipient, id);
      const existing = this._receipts.get(key);
      if (message && !existing && id <= (this._delivered.get(recipient) || 0)) {
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.ACK_INVALID,
          `TeamMailbox.acknowledge: message ${id} is outside the retained receipt window`,
        );
      }
      if (
        !message &&
        existing &&
        ["processed", "dead_letter"].includes(existing.status)
      ) {
        if (existing.consumerKey !== normalizedConsumerKey) {
          throw createMailboxError(
            TEAM_MAILBOX_ERROR_CODES.ACK_CONFLICT,
            `TeamMailbox.acknowledge: message ${id} was settled by another consumer`,
          );
        }
        if (existing.status !== status) {
          throw createMailboxError(
            TEAM_MAILBOX_ERROR_CODES.ACK_CONFLICT,
            `TeamMailbox.acknowledge: message ${id} already has terminal status ${existing.status}`,
          );
        }
        return { id, key, message: null, existing, replay: true };
      }
      if (
        !message ||
        message.from === recipient ||
        !this._isFor(message, recipient)
      ) {
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.ACK_INVALID,
          `TeamMailbox.acknowledge: message ${id} is not addressed to ${recipient}`,
        );
      }
      if (
        existing &&
        ["processed", "dead_letter"].includes(existing.status) &&
        existing.consumerKey !== normalizedConsumerKey
      ) {
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.ACK_CONFLICT,
          `TeamMailbox.acknowledge: message ${id} was settled by another consumer`,
        );
      }
      if (
        existing &&
        ["processed", "dead_letter"].includes(existing.status) &&
        existing.status !== status
      ) {
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.ACK_CONFLICT,
          `TeamMailbox.acknowledge: message ${id} already has terminal status ${existing.status}`,
        );
      }
      return {
        id,
        key,
        message,
        existing,
        replay:
          existing != null &&
          ["processed", "dead_letter"].includes(existing.status),
      };
    });
    this._ensureReceiptCapacity(
      plans.reduce((count, plan) => count + (plan.existing ? 0 : 1), 0),
    );

    const now = this._now();
    const receipts = [];
    for (const plan of plans) {
      if (plan.replay) {
        receipts.push(this._cloneMessage(plan.existing));
        continue;
      }
      const receipt = plan.existing || {
        recipient,
        messageId: plan.id,
        status: "delivered",
        deliveryCount: 1,
        deliveredAt: now,
        readAt: null,
        processedAt: null,
        deadLetteredAt: null,
        consumerKey: null,
        reason: null,
        recipientAttempt: null,
      };
      const wasTerminal = ["processed", "dead_letter"].includes(receipt.status);
      receipt.status = status;
      receipt.consumerKey = normalizedConsumerKey;
      receipt.recipientAttempt = normalizedRecipientAttempt;
      if (status === "read") receipt.readAt ||= now;
      if (status === "processed") {
        receipt.readAt ||= now;
        receipt.processedAt ||= now;
        if (!wasTerminal) this._counters.processedMessages += 1;
      }
      if (status === "dead_letter") {
        receipt.deadLetteredAt ||= now;
        receipt.reason = normalizedReason;
        if (!wasTerminal) this._counters.deadLetteredMessages += 1;
      }
      this._receipts.set(plan.key, receipt);
      receipts.push(this._cloneMessage(receipt));
    }

    // Advance only across the contiguous addressed prefix that has a terminal
    // receipt. Out-of-order ACKs remain durable but cannot skip an earlier
    // unprocessed message.
    let cursor = this._delivered.get(recipient) || 0;
    for (const message of this._log) {
      if (
        message.id <= cursor ||
        message.from === recipient ||
        !this._isFor(message, recipient)
      ) {
        continue;
      }
      const receipt = this._receipts.get(
        this._receiptKey(recipient, message.id),
      );
      if (!receipt || !["processed", "dead_letter"].includes(receipt.status)) {
        break;
      }
      cursor = message.id;
    }
    this._delivered.set(recipient, cursor);
    this._trimReceiptHistory();
    return { receipts, cursor };
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
      receipts: this._receipts.size,
      idempotencyRecords: this._idempotency.size,
    };
  }

  snapshot() {
    return {
      version: 3,
      limits: { ...this._limits },
      log: this._log.map((m) => this._cloneMessage(m)),
      seq: this._seq,
      delivered: Array.from(this._delivered.entries()),
      recipients: Array.from(this._recipients),
      totalBytes: this._totalBytes,
      counters: { ...this._counters },
      receipts: Array.from(this._receipts.entries()).map(([key, receipt]) => [
        key,
        this._cloneMessage(receipt),
      ]),
      idempotency: Array.from(this._idempotency.entries()).map(
        ([key, record]) => [key, this._cloneMessage(record)],
      ),
    };
  }

  static restore(
    snap,
    {
      now = () => Date.now(),
      maxMessageBytes,
      maxMessages,
      maxTotalBytes,
      maxReceiptHistory,
      maxIdempotencyHistory,
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
      maxReceiptHistory:
        maxReceiptHistory ??
        savedLimits.maxReceiptHistory ??
        DEFAULT_TEAM_MAILBOX_LIMITS.maxReceiptHistory,
      maxIdempotencyHistory:
        maxIdempotencyHistory ??
        savedLimits.maxIdempotencyHistory ??
        DEFAULT_TEAM_MAILBOX_LIMITS.maxIdempotencyHistory,
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
    mb._receipts = new Map();
    for (const entry of Array.isArray(snap?.receipts) ? snap.receipts : []) {
      const [key, receipt] = Array.isArray(entry) ? entry : [];
      if (
        typeof key !== "string" ||
        !receipt ||
        typeof receipt !== "object" ||
        typeof receipt.recipient !== "string" ||
        !Number.isSafeInteger(receipt.messageId) ||
        receipt.messageId <= 0 ||
        receipt.messageId > mb._seq ||
        !RECEIPT_STATUSES.has(receipt.status) ||
        key !== mb._receiptKey(receipt.recipient, receipt.messageId)
      ) {
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
          "TeamMailbox.restore: invalid message receipt",
        );
      }
      mb._receipts.set(key, mb._cloneMessage(receipt));
    }
    if (mb._receipts.size > mb._limits.maxReceiptHistory) {
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.CAPACITY_EXCEEDED,
        "TeamMailbox.restore: receipt history exceeds mailbox capacity",
      );
    }
    mb._idempotency = new Map();
    for (const entry of Array.isArray(snap?.idempotency)
      ? snap.idempotency
      : []) {
      const [key, record] = Array.isArray(entry) ? entry : [];
      if (
        typeof key !== "string" ||
        !record ||
        typeof record !== "object" ||
        !Number.isSafeInteger(record.messageId) ||
        record.messageId <= 0 ||
        record.messageId > mb._seq ||
        typeof record.payloadDigest !== "string" ||
        !record.message ||
        record.message.id !== record.messageId
      ) {
        throw createMailboxError(
          TEAM_MAILBOX_ERROR_CODES.MESSAGE_INVALID,
          "TeamMailbox.restore: invalid idempotency record",
        );
      }
      mb._idempotency.set(key, mb._cloneMessage(record));
    }
    if (mb._idempotency.size > mb._limits.maxIdempotencyHistory) {
      throw createMailboxError(
        TEAM_MAILBOX_ERROR_CODES.CAPACITY_EXCEEDED,
        "TeamMailbox.restore: idempotency history exceeds mailbox capacity",
      );
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
      deliveryAttempts: nonNegativeNumber(counters?.deliveryAttempts),
      processedMessages: nonNegativeNumber(counters?.processedMessages),
      deadLetteredMessages: nonNegativeNumber(counters?.deadLetteredMessages),
      idempotentReplays: nonNegativeNumber(counters?.idempotentReplays),
    };
    return mb;
  }
}
